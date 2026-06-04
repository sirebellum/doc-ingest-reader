#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTBridge+Private.h>
#import <jsi/jsi.h>
#import "RustParserBridge.h"

@interface RustParserBridgeModule : NSObject <RCTBridgeModule>
@end

@implementation RustParserBridgeModule

RCT_EXPORT_MODULE(RustParserBridgeModule);

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

- (void)setBridge:(RCTBridge *)bridge {
    // Hold reference to base bridge
    _bridge = bridge;
    
    // Attempt CXX bridge cast to resolve JSI runtime pointer
    if ([bridge respondsToSelector:@selector(runtime)]) {
        RCTCxxBridge *cxxBridge = (RCTCxxBridge *)bridge;
        if (cxxBridge.runtime) {
            facebook::jsi::Runtime *runtime = (facebook::jsi::Runtime *)cxxBridge.runtime;
            if (runtime) {
                facebook::jsi::RustParserBridge::install(*runtime, std::make_shared<facebook::jsi::RustParserBridge>());
                NSLog(@"[RustParserBridgeModule iOS] Successfully installed Rust JSI bindings.");
            }
        }
    }
}

@end
