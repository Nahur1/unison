package io.github.nahur1.unison;

import android.net.Uri;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.DataReader;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.ParsableByteArray;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.FileDataSource;
import androidx.media3.extractor.DefaultExtractorInput;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.DiscardingTrackOutput;
import androidx.media3.extractor.Extractor;
import androidx.media3.extractor.ExtractorInput;
import androidx.media3.extractor.ExtractorOutput;
import androidx.media3.extractor.PositionHolder;
import androidx.media3.extractor.SeekMap;
import androidx.media3.extractor.TrackOutput;
import androidx.media3.extractor.text.CueDecoder;
import androidx.media3.extractor.text.CuesWithTiming;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Reads the text subtitle tracks stored inside an imported MKV/MP4 file.
 * The WebView can play these files but never exposes their subtitle tracks,
 * so Media3's extractors read them (SubRip, SSA/ASS, WebVTT, TTML, tx3g) and
 * transcode every cue to one format with start and end times.
 */
@OptIn(markerClass = UnstableApi.class)
final class SubtitleExtractor {
    private SubtitleExtractor() {}

    private static final class Text implements TrackOutput {
        Format format;
        final ByteArrayOutputStream pending = new ByteArrayOutputStream();
        final List<CuesWithTiming> cues = new ArrayList<>();
        private final byte[] scratch = new byte[16 * 1024];
        private final CueDecoder decoder = new CueDecoder();

        @Override public void format(Format value) { format = value; }

        @Override public int sampleData(DataReader input, int length, boolean allowEndOfInput, int part) throws IOException {
            int read = input.read(scratch, 0, Math.min(length, scratch.length));
            if (read == C.RESULT_END_OF_INPUT) {
                if (allowEndOfInput) return C.RESULT_END_OF_INPUT;
                throw new java.io.EOFException();
            }
            pending.write(scratch, 0, read);
            return read;
        }

        @Override public void sampleData(ParsableByteArray data, int length, int part) {
            byte[] bytes = new byte[length];
            data.readBytes(bytes, 0, length);
            pending.write(bytes, 0, length);
        }

        @Override public void sampleMetadata(long timeUs, int flags, int size, int offset, CryptoData crypto) {
            byte[] all = pending.toByteArray();
            int start = all.length - offset - size;
            if (start >= 0 && size > 0 && format != null && MimeTypes.APPLICATION_MEDIA3_CUES.equals(format.sampleMimeType)) {
                try { cues.add(decoder.decode(timeUs, all, start, size)); } catch (RuntimeException ignored) { /* skip a damaged cue */ }
            }
            pending.reset();
            if (offset > 0) pending.write(all, all.length - offset, offset);
        }
    }

    private static final class Output implements ExtractorOutput {
        final List<Text> texts = new ArrayList<>();
        boolean ended;

        @Override public TrackOutput track(int id, int type) {
            if (type != C.TRACK_TYPE_TEXT) return new DiscardingTrackOutput();
            Text text = new Text();
            texts.add(text);
            return text;
        }

        @Override public void endTracks() { ended = true; }

        @Override public void seekMap(SeekMap seekMap) {}
    }

    private static ExtractorInput open(FileDataSource source, File file, long position) throws IOException {
        source.close();
        long length = source.open(new DataSpec.Builder().setUri(Uri.fromFile(file)).setPosition(position).build());
        return new DefaultExtractorInput(source, position, length == C.LENGTH_UNSET ? C.LENGTH_UNSET : position + length);
    }

    static JSArray extract(File file) throws IOException {
        DefaultExtractorsFactory factory = new DefaultExtractorsFactory();
        factory.experimentalSetTextTrackTranscodingEnabled(true);
        FileDataSource source = new FileDataSource();
        Output output = new Output();
        Extractor extractor = null;
        try {
            ExtractorInput input = null;
            for (Extractor candidate : factory.createExtractors(Uri.fromFile(file), Collections.emptyMap())) {
                input = open(source, file, 0);
                boolean match;
                try { match = candidate.sniff(input); } catch (IOException | RuntimeException e) { match = false; }
                if (match) { extractor = candidate; break; }
                candidate.release();
            }
            if (extractor == null) return new JSArray();
            input = open(source, file, 0);
            extractor.init(output);
            PositionHolder seek = new PositionHolder();
            while (true) {
                // Container headers list every track first: a file without text
                // tracks is done here instead of being read to the end.
                if (output.ended && output.texts.isEmpty()) break;
                int result = extractor.read(input, seek);
                if (result == Extractor.RESULT_END_OF_INPUT) break;
                if (result == Extractor.RESULT_SEEK) input = open(source, file, seek.position);
            }
        } finally {
            if (extractor != null) extractor.release();
            source.close();
        }
        JSArray tracks = new JSArray();
        for (Text text : output.texts) {
            JSArray cues = toCues(text.cues);
            if (cues.length() == 0) continue;
            JSObject track = new JSObject();
            Format format = text.format;
            track.put("language", format == null || format.language == null ? "" : format.language);
            track.put("label", format == null || format.label == null ? "" : format.label);
            track.put("cues", cues);
            tracks.put(track);
        }
        return tracks;
    }

    private static JSArray toCues(List<CuesWithTiming> list) {
        Collections.sort(list, (a, b) -> Long.compare(a.startTimeUs, b.startTimeUs));
        JSArray result = new JSArray();
        for (int i = 0; i < list.size(); i++) {
            CuesWithTiming item = list.get(i);
            StringBuilder text = new StringBuilder();
            for (androidx.media3.common.text.Cue cue : item.cues) {
                if (cue.text == null) continue;
                String line = cue.text.toString().trim();
                if (line.isEmpty()) continue;
                if (text.length() > 0) text.append('\n');
                text.append(line);
            }
            if (text.length() == 0 || item.startTimeUs == C.TIME_UNSET) continue;
            long end = item.durationUs != C.TIME_UNSET ? item.endTimeUs
                : i + 1 < list.size() ? list.get(i + 1).startTimeUs : item.startTimeUs + 4_000_000;
            JSObject cue = new JSObject();
            cue.put("start", item.startTimeUs / 1e6);
            cue.put("end", Math.max(end, item.startTimeUs + 300_000) / 1e6);
            cue.put("text", text.toString());
            result.put(cue);
        }
        return result;
    }
}
