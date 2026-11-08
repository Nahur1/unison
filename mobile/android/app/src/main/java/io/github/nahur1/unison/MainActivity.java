package io.github.nahur1.unison;
import android.content.res.Configuration;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle savedInstanceState){registerPlugin(UnisonMediaPlugin.class);super.onCreate(savedInstanceState);}
 // Leaving the app while a video plays keeps it on screen as a mini player.
 @Override protected void onUserLeaveHint(){super.onUserLeaveHint();UnisonMediaPlugin plugin=UnisonMediaPlugin.instance;if(plugin!=null&&plugin.autoPictureInPicture)plugin.enterPictureInPicture();}
 @Override public void onPictureInPictureModeChanged(boolean active,Configuration config){super.onPictureInPictureModeChanged(active,config);UnisonMediaPlugin plugin=UnisonMediaPlugin.instance;if(plugin!=null)plugin.pictureInPictureChanged(active);}
}
