export const colors = {
  bg: '#080A0F',
  bgSoft: '#0D111A',
  surface: '#141824',
  surfaceElevated: '#1A2030',
  surfacePressed: '#20283A',
  border: '#2A3348',
  borderSoft: '#20283A',
  text: '#F8FAFC',
  textSoft: '#CBD5E1',
  muted: '#94A3B8',
  muted2: '#64748B',
  faint: '#475569',
  primary: '#F04438',
  primaryDark: '#B42318',
  accent: '#7C5CFF',
  accentSoft: '#262244',
  success: '#16A34A',
  warning: '#F6C85F',
  dangerBg: '#2A1114',
  warningBg: '#251F12',
  overlay: 'rgba(0,0,0,0.68)',
  blackGlass: 'rgba(0,0,0,0.58)',
  whiteGlass: 'rgba(255,255,255,0.08)',
};

export const gradients = {
  app: [colors.bg, '#101624'] as const,
  sheet: ['#121827', '#0B0F17'] as const,
  hero: ['#0B0F17', '#151A2A'] as const,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
};
