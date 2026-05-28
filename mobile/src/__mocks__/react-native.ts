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

export const View = 'View';
export const Text = 'Text';
