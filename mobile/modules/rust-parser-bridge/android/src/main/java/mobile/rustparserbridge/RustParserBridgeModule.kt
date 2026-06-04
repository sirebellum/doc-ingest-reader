package mobile.rustparserbridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import com.facebook.react.bridge.ReactContext

class RustParserBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RustParserBridgeModule")

    OnCreate {
      val reactContext = appContext.reactContext as? ReactContext ?: return@OnCreate
      val jsContextPointer = reactContext.javaScriptContextHolder?.get() ?: return@OnCreate
      nativeInstall(jsContextPointer)
    }
  }

  private external fun nativeInstall(jsContextPointer: Long)

  companion object {
    init {
      System.loadLibrary("RustParserBridge")
    }
  }
}
