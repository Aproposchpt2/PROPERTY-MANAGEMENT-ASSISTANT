// Stellar / PMA brand treatment, matching pma-site.css: black, gold and white (ivory), square
// corners, thin gold lines; Cormorant Garamond for headlines, DM Sans for text, Syncopate for small
// spaced labels. The only other colour is a deep red reserved for emergencies, so they stand out.

const brand = {
  black: '#050505',
  surface: '#101010',
  raised: '#151515',
  charcoal: '#171717',
  gold: '#C8A84B',
  goldLight: '#E4C878',
  goldDeep: '#29210F',
  ivory: '#F7F4EC',
  text: '#D3CEC1',
  muted: '#9E988B',
  line: 'rgba(200,168,75,0.28)',
  lineStrong: 'rgba(200,168,75,0.6)',
  danger: '#B42318',
  dangerText: '#F4B4AE',
  dangerSoft: '#2A1210',
};

export const colors = {
  ...brand,
  // Semantic names used across the screens.
  header: brand.black,       // header bars
  page: brand.black,         // screen background
  card: brand.surface,       // cards and inputs
  accent: brand.gold,        // primary buttons, selected chips, icons
  onAccent: brand.black,     // text on gold
  ink: brand.ivory,          // headings
  body: brand.text,          // body text
  field: 'rgba(200,168,75,0.45)', // input borders
  urgent: brand.danger,
  urgentText: brand.dangerText,
  urgentSoft: brand.dangerSoft,
};

// Font families registered in app/_layout.tsx (one family per weight).
export const fonts = {
  serif: 'CormorantGaramond_500Medium',
  serifRegular: 'CormorantGaramond_400Regular',
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_600SemiBold',
  label: 'Syncopate_400Regular',
};

// Header bars: black with a thin gold rule, gold back arrow, ivory serif title.
export const headerOptions = {
  headerStyle: { backgroundColor: colors.header },
  headerTintColor: colors.goldLight,
  headerTitleStyle: { fontFamily: fonts.serif, fontSize: 22, color: colors.ivory },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.page, borderTopWidth: 1, borderTopColor: colors.line },
};

export const radius = 2; // the site uses square corners; a hair of rounding reads better on phones
