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

    AsyncFunction("parsePDFAsync") { localPath: String ->
      parsePDFSyncNative(localPath)
    }

    AsyncFunction("runInferenceAsync") { modelPath: String, prompt: String ->
      runInferenceSyncNative(modelPath, prompt)
    }

    AsyncFunction("delineatePageAsync") { pageExtractionJson: String, modelPath: String ->
      delineatePageSyncNative(pageExtractionJson, modelPath)
    }

    AsyncFunction("getHeapStats") {
      getHeapStatsSyncNative()
    }

    AsyncFunction("configureNpu") { configJson: String ->
      configureNpuSyncNative(configJson)
    }
  }

  private external fun nativeInstall(jsContextPointer: Long)
  
  private external fun parsePDFSyncNative(localPath: String): String
  private external fun runInferenceSyncNative(modelPath: String, prompt: String): String
  private external fun delineatePageSyncNative(pageExtractionJson: String, modelPath: String): String
  private external fun getHeapStatsSyncNative(): String
  private external fun configureNpuSyncNative(configJson: String): Int

  companion object {
    init {
      System.loadLibrary("RustParserBridge")
    }
  }
}
