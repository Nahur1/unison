package io.github.nahur1.unison;

import android.app.Activity;
import android.content.Intent;
import android.content.ComponentName;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.*;
import java.util.*;
import java.util.concurrent.Executors;
import org.json.*;

@CapacitorPlugin(name="UnisonMedia")
public class UnisonMediaPlugin extends Plugin {
    private MediaController controller;
    private ListenableFuture<MediaController> connecting;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final java.util.concurrent.ExecutorService imports=Executors.newSingleThreadExecutor();
    private final Runnable tick=new Runnable(){public void run(){emit(false);handler.postDelayed(this,250);}};
    @Override public void load(){handler.post(tick);}
    private void emit(boolean ended){if(controller==null)return;JSObject result=new JSObject();result.put("playing",controller.isPlaying());result.put("position",controller.getCurrentPosition()/1000.0);result.put("duration",Math.max(0,controller.getDuration())/1000.0);result.put("ended",ended);MediaItem item=controller.getCurrentMediaItem();result.put("trackId",item==null?"":item.mediaId);notifyListeners("state",result);}
    private interface Action { void run() throws Exception; }
    private void connected(PluginCall call,Action action){getActivity().runOnUiThread(()->{
        if(controller!=null){execute(call,action);return;}
        if(connecting==null)connecting=new MediaController.Builder(getContext(),new SessionToken(getContext(),new ComponentName(getContext(),PlaybackService.class))).buildAsync();
        connecting.addListener(()->{try{boolean first=controller==null;controller=connecting.get();if(first)controller.addListener(new Player.Listener(){@Override public void onPlaybackStateChanged(int state){emit(state==Player.STATE_ENDED);}@Override public void onIsPlayingChanged(boolean value){emit(false);}});execute(call,action);}catch(Exception e){connecting=null;call.reject("Could not connect to playback service",e);}},ContextCompat.getMainExecutor(getContext()));
    });}
    private void execute(PluginCall call,Action action){try{action.run();call.resolve();}catch(Exception e){call.reject(e.getMessage(),e);}}
    private Uri localUri(String path)throws IOException{return Uri.fromFile(LocalMedia.requireImported(getContext().getFilesDir(),path));}
    @PluginMethod public void pickFiles(PluginCall call){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.setType("*/*");intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"audio/*","video/*"});intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);intent.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(call,intent,"filesSelected");}
    @ActivityCallback private void filesSelected(PluginCall call,ActivityResult result){if(call==null)return;if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null){call.resolve(new JSObject().put("files",new JSArray()));return;}Intent data=result.getData();List<Uri> uris=new ArrayList<>();if(data.getClipData()!=null){for(int i=0;i<data.getClipData().getItemCount();i++)uris.add(data.getClipData().getItemAt(i).getUri());}else if(data.getData()!=null)uris.add(data.getData());
        imports.execute(()->{JSArray files=new JSArray();try{File folder=new File(getContext().getFilesDir(),"media");if(!folder.isDirectory()&&!folder.mkdirs())throw new IOException("Could not create media folder");for(Uri uri:uris){String name="Media";try(Cursor cursor=getContext().getContentResolver().query(uri,null,null,null,null)){if(cursor!=null&&cursor.moveToFirst()){int column=cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);if(column>=0)name=cursor.getString(column);}}String mime=getContext().getContentResolver().getType(uri);if(mime==null||(!mime.startsWith("audio/")&&!mime.startsWith("video/")))continue;
            String extension=name.contains(".")?name.substring(name.lastIndexOf('.')).replaceAll("[^.a-zA-Z0-9]",""):"";File target=new File(folder,UUID.randomUUID()+extension);File partial=new File(folder,target.getName()+".part");try(InputStream input=getContext().getContentResolver().openInputStream(uri);OutputStream output=new FileOutputStream(partial)){if(input==null)throw new IOException("Could not read "+name);byte[] buffer=new byte[128*1024];int read;while((read=input.read(buffer))!=-1)output.write(buffer,0,read);}catch(Exception e){partial.delete();throw e;}if(!partial.renameTo(target))throw new IOException("Could not finish importing "+name);
            JSObject item=new JSObject();item.put("path",target.getAbsolutePath());item.put("uri",Uri.fromFile(target).toString());item.put("name",name);item.put("size",target.length());item.put("mime",mime);
            try(android.media.MediaMetadataRetriever metadata=new android.media.MediaMetadataRetriever()) {
                metadata.setDataSource(target.getAbsolutePath());
                item.put("title",metadata.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_TITLE));
                item.put("artist",metadata.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ARTIST));
                item.put("album",metadata.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ALBUM));
                String duration=metadata.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION);
                if(duration!=null)item.put("duration",Long.parseLong(duration)/1000.0);
                byte[] cover=metadata.getEmbeddedPicture();
                if(cover!=null&&cover.length<10*1024*1024){android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inJustDecodeBounds=true;android.graphics.BitmapFactory.decodeByteArray(cover,0,cover.length,options);options.inSampleSize=Math.max(1,Math.max(options.outWidth,options.outHeight)/512);options.inJustDecodeBounds=false;android.graphics.Bitmap bitmap=android.graphics.BitmapFactory.decodeByteArray(cover,0,cover.length,options);if(bitmap!=null){ByteArrayOutputStream jpeg=new ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,85,jpeg);bitmap.recycle();item.put("artwork",android.util.Base64.encodeToString(jpeg.toByteArray(),android.util.Base64.NO_WRAP));}}
            }catch(Exception optionalMetadata) { /* A malformed tag must not prevent local playback. */ }
            files.put(item);
        }call.resolve(new JSObject().put("files",files));}catch(Exception e){call.reject("Import failed: "+e.getMessage(),e);}});
    }
    @PluginMethod public void play(PluginCall call){connected(call,()->{List<MediaItem> list=new ArrayList<>();JSArray items=call.getArray("items",new JSArray());for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);list.add(new MediaItem.Builder().setMediaId(item.getString("id")).setUri(localUri(item.getString("uri"))).setMediaMetadata(new MediaMetadata.Builder().setTitle(item.optString("title")).setArtist(item.optString("artist")).build()).build());}if(list.isEmpty())list.add(new MediaItem.Builder().setUri(localUri(call.getString("uri"))).build());int index=call.getInt("index",0);controller.setMediaItems(list,Math.min(Math.max(index,0),list.size()-1),(long)(call.getDouble("position",0.0)*1000));controller.prepare();controller.play();});}
    @PluginMethod public void sleep(PluginCall call){connected(call,()->{if(PlaybackService.instance!=null)PlaybackService.instance.sleep(call.getInt("minutes",0));});}
    @PluginMethod public void removeFile(PluginCall call){try{Uri uri=localUri(call.getString("path"));File file=new File(uri.getPath());if(!file.delete())throw new IOException("Could not remove imported copy");call.resolve();}catch(Exception e){call.reject(e.getMessage(),e);}}
    @PluginMethod public void status(PluginCall call){connected(call,()->emit(false));}
    @PluginMethod public void pause(PluginCall call){connected(call,()->controller.pause());}
    @PluginMethod public void resume(PluginCall call){connected(call,()->{if(controller.getMediaItemCount()==0)throw new IOException("Select a track to start playback");controller.play();});}
    @PluginMethod public void seek(PluginCall call){connected(call,()->controller.seekTo((long)(call.getDouble("position",0.0)*1000)));}
    @PluginMethod public void configure(PluginCall call){connected(call,()->{controller.setVolume(call.getBoolean("muted",false)?0:call.getFloat("volume",0.8f));controller.setPlaybackSpeed(call.getFloat("speed",1f));String repeat=call.getString("repeat","off");controller.setRepeatMode(repeat.equals("one")?Player.REPEAT_MODE_ONE:repeat.equals("all")?Player.REPEAT_MODE_ALL:Player.REPEAT_MODE_OFF);controller.setShuffleModeEnabled(call.getBoolean("shuffle",false));if(PlaybackService.instance!=null){float[] values=new float[10];JSArray array=call.getArray("gains",new JSArray());for(int i=0;i<Math.min(10,array.length());i++)values[i]=(float)array.optDouble(i,0);PlaybackService.instance.configureEqualizer(call.getBoolean("eq",false),values);}});}
    @PluginMethod public void stop(PluginCall call){getActivity().runOnUiThread(()->{if(controller!=null){controller.stop();controller.clearMediaItems();}call.resolve();});}
    @PluginMethod public void close(PluginCall call){getActivity().runOnUiThread(()->{if(PlaybackService.instance!=null)PlaybackService.instance.stopPlayback();getContext().stopService(new Intent(getContext(),PlaybackService.class));call.resolve();getActivity().finishAndRemoveTask();});}
    @Override protected void handleOnDestroy(){handler.removeCallbacksAndMessages(null);imports.shutdown();if(connecting!=null)MediaController.releaseFuture(connecting);controller=null;super.handleOnDestroy();}
}
