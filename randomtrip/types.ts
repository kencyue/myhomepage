export interface PlaceLink {
  title: string;
  uri: string;
}

export interface Recommendation {
  content: string;
  links: PlaceLink[];
  timestamp: number;
}

export enum SearchType {
  GLOBAL = 'GLOBAL',
  NEARBY = 'NEARBY'
}

export enum Category {
  ALL = '綜合',
  NATURE = '自然風光',
  HISTORICAL = '歷史古蹟',
  FOOD = '美食之旅',
  URBAN = '城市探索',
  HIDDEN_GEM = '私房秘境'
}

export interface GeoLocation {
  lat: number;
  lng: number;
}