package io.github.nahur1.unison;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle savedInstanceState){registerPlugin(UnisonMediaPlugin.class);super.onCreate(savedInstanceState);}
}
