package io.github.nahur1.unison;
import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import androidx.media3.common.MediaItem;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;
import org.junit.runner.RunWith;
@RunWith(AndroidJUnit4.class)
public class PlaybackLifecycleTest {
    @Test public void realAudioAdvancesAndTaskRemovalStopsService() throws Exception {
        var instrumentation=InstrumentationRegistry.getInstrumentation();
        Context context=instrumentation.getTargetContext();
        assertEquals("io.github.nahur1.unison",context.getPackageName());
        File file=new File(context.getCacheDir(),"lifecycle.wav");
        int samples=8000*15;ByteBuffer wav=ByteBuffer.allocate(44+samples*2).order(ByteOrder.LITTLE_ENDIAN);
        wav.put("RIFF".getBytes()).putInt(36+samples*2).put("WAVEfmt ".getBytes()).putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(16000).putShort((short)2).putShort((short)16).put("data".getBytes()).putInt(samples*2);
        for(int i=0;i<samples;i++)wav.putShort((short)(Math.sin(i*2*Math.PI*440/8000)*1500));
        try(FileOutputStream out=new FileOutputStream(file)){out.write(wav.array());}
        try(ActivityScenario<MainActivity> activity=ActivityScenario.launch(MainActivity.class)) {
            context.startService(new Intent(context,PlaybackService.class));
            for(int i=0;i<50&&PlaybackService.instance==null;i++)Thread.sleep(100);
            assertNotNull(PlaybackService.instance);
            instrumentation.runOnMainSync(()->{var p=PlaybackService.instance.player;p.setMediaItem(MediaItem.fromUri(Uri.fromFile(file)));p.prepare();p.play();});
            java.util.concurrent.atomic.AtomicBoolean advancing=new java.util.concurrent.atomic.AtomicBoolean(false);
            for(int i=0;i<100&&!advancing.get();i++) {
                instrumentation.runOnMainSync(()->advancing.set(PlaybackService.instance.player.isPlaying()&&PlaybackService.instance.player.getCurrentPosition()>500));
                Thread.sleep(100);
            }
            assertTrue("Audio did not advance on the emulator",advancing.get());
            instrumentation.runOnMainSync(()->{assertTrue(PlaybackService.instance.player.isPlaying());assertTrue(PlaybackService.instance.player.getCurrentPosition()>500);PlaybackService.instance.player.setVolume(0);assertEquals(0,PlaybackService.instance.player.getVolume(),0.001);PlaybackService.instance.player.setVolume(.8f);});
            activity.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            Thread.sleep(1200);
            instrumentation.runOnMainSync(()->{assertTrue(PlaybackService.instance.player.isPlaying());PlaybackService.instance.onTaskRemoved(null);});
            for(int i=0;i<50&&PlaybackService.instance!=null;i++)Thread.sleep(100);
            assertNull(PlaybackService.instance);
        } finally { context.stopService(new Intent(context,PlaybackService.class));file.delete(); }
    }
}
