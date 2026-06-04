#include <jni.h>
#include <jsi/jsi.h>
#include "RustParserBridge.h"

extern "C"
JNIEXPORT void JNICALL
Java_mobile_rustparserbridge_RustParserBridgeModule_nativeInstall(JNIEnv *env, jobject thiz, jlong js_context_pointer) {
    auto runtime = reinterpret_cast<facebook::jsi::Runtime *>(js_context_pointer);
    if (runtime) {
        facebook::jsi::RustParserBridge::install(*runtime, std::make_shared<facebook::jsi::RustParserBridge>());
    }
}
