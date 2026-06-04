export const Dimensions = {
  get: jest.fn().mockReturnValue({
    width: 375,
    height: 812,
    scale: 3,
    fontScale: 1,
  }),
  addEventListener: jest.fn().mockReturnValue({
    remove: jest.fn(),
  }),
};

export const StyleSheet = {
  create: (styles: any) => styles,
};

export const Platform = {
  OS: 'ios',
  select: jest.fn((obj) => obj.ios || obj.default),
};

export const Animated = {
  View: 'Animated.View',
  createAnimatedComponent: jest.fn((val) => val),
  timing: jest.fn(() => ({ start: jest.fn((cb) => cb && cb({ finished: true })) })),
  spring: jest.fn(() => ({ start: jest.fn((cb) => cb && cb({ finished: true })) })),
  parallel: jest.fn((arr) => ({
    start: jest.fn((cb) => {
      arr.forEach((anim: any) => anim.start && anim.start());
      if (cb) cb({ finished: true });
    })
  })),
  Value: jest.fn(() => ({
    interpolate: jest.fn(),
    setValue: jest.fn(),
  })),
};

export const LayoutAnimation = {
  configureNext: jest.fn(),
  Presets: {
    easeInEaseOut: 'easeInEaseOut',
    linear: 'linear',
    spring: 'spring',
  },
};

export const UIManager = {
  setLayoutAnimationEnabledExperimental: jest.fn(),
};

export const useWindowDimensions = jest.fn().mockReturnValue({
  width: 375,
  height: 812,
  scale: 3,
  fontScale: 1,
});

export const View = 'View';
export const Text = 'Text';
export const TouchableOpacity = 'TouchableOpacity';
export const TextInput = 'TextInput';
export const ScrollView = 'ScrollView';
export const ActivityIndicator = 'ActivityIndicator';
export const SafeAreaView = 'SafeAreaView';
export const FlatList = 'FlatList';
export const Modal = 'Modal';

export const Alert = {
  alert: jest.fn(),
};
