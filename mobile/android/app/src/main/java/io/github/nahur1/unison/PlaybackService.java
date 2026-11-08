package io.github.nahur1.unison;

import android.app.PendingIntent;
import android.content.Intent;
import android.media.audiofx.Equalizer;
import androidx.annotation.Nullable;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

/** Music owns a foreground media session; task removal always stops the service. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public class PlaybackService extends MediaSessionService {
    static PlaybackService instance;
    ExoPlayer player;
    private final android.os.Handler timer=new android.os.Handler(android.os.Looper.getMainLooper());
    void sleep(int minutes){timer.removeCallbacksAndMessages(null);if(minutes>0)timer.postDelayed(()->player.pause(),minutes*60000L);}
    private MediaSession session;
    private Equalizer equalizer;
    private float[] gains = new float[10];
    private boolean eqEnabled;
    private int audioSession;
    private static final int[] FREQUENCIES = {31,62,125,250,500,1000,2000,4000,8000,16000};
    @Override public void onCreate() {
        super.onCreate(); instance = this;
        player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true);
        player.setHandleAudioBecomingNoisy(true);
        player.setWakeMode(C.WAKE_MODE_LOCAL);
        player.addAnalyticsListener(new AnalyticsListener() {
            @Override public void onAudioSessionIdChanged(EventTime eventTime, int id) { audioSession=id; rebuildEqualizer(); }
        });
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent activity = PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        session = new MediaSession.Builder(this,player).setSessionActivity(activity).build();
    }
    void configureEqualizer(boolean enabled, float[] values) { if(eqEnabled==enabled && java.util.Arrays.equals(gains,values))return; eqEnabled=enabled; gains=values; rebuildEqualizer(); }
    private void rebuildEqualizer() {
        if(equalizer!=null) { equalizer.release(); equalizer=null; }
        if(!eqEnabled || audioSession<=0)return;
        try {
            equalizer=new Equalizer(0,audioSession);
            short[] range=equalizer.getBandLevelRange();
            for(short band=0;band<equalizer.getNumberOfBands();band++) {
                double hz=equalizer.getCenterFreq(band)/1000.0; int nearest=0;
                for(int i=1;i<FREQUENCIES.length;i++)if(Math.abs(Math.log(hz/FREQUENCIES[i]))<Math.abs(Math.log(hz/FREQUENCIES[nearest])))nearest=i;
                equalizer.setBandLevel(band,(short)Math.max(range[0],Math.min(range[1],gains[nearest]*100)));
            }
            equalizer.setEnabled(true);
        } catch(RuntimeException unavailable) { if(equalizer!=null)equalizer.release();equalizer=null; }
    }
    @Nullable @Override public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        // Only our app and system media controls get a session.
        if(controllerInfo.getUid()==android.os.Process.myUid() || controllerInfo.isTrusted())return session;
        return null;
    }
    @Override public void onTaskRemoved(@Nullable Intent rootIntent) { stopPlayback(); stopSelf(); }
    public void stopPlayback() { if(player!=null){player.stop();player.clearMediaItems();}stopForeground(STOP_FOREGROUND_REMOVE); }
    @Override public void onDestroy() {
        timer.removeCallbacksAndMessages(null);
        if(equalizer!=null)equalizer.release();
        if(session!=null)session.release();
        if(player!=null)player.release();
        instance=null; super.onDestroy();
    }
}
