/**
 * PORT ADDITION: the screen's copy, in English and Turkish.
 *
 * Every word the component puts on screen or into the live region comes from
 * here. The rule that decides what belongs in this file and what does not is
 * **display versus data**:
 *
 * - *Display* is chrome — button names, column headings, the operator words in
 *   a filter chip, the metric names in the cog panel, the live region's
 *   sentences. All of it is translated, and none of it is ever compared,
 *   parsed, stored or exported.
 * - *Data* is the record's own values: `status` is the string `'Success'`,
 *   `favouriteSeason` is `'Spring'`, and they stay that way in every locale.
 *   They are the keys the filter dock matches on, the keys `rate:status:Success`
 *   is built from, the keys `PILL_CLASS` paints from, and the bytes a host reads
 *   back through `onRecordsChange`. Translating them would fork the data model
 *   per language. What is translated is how they *read*: `STRINGS.tr.status`
 *   maps the canonical value to the word, at the point it is rendered.
 *
 * The same split explains the two column tables. `COLUMN_LABELS` in `types.ts`
 * stays English and stays exported — it is a stable public identifier, and it
 * is what a `.csv` header falls back to. `Strings.columns` is the one the header
 * row, the dock's chips and the cog's group headings actually render.
 *
 * Dates are the deliberate exception in the other direction. A record's `date`
 * is free text in the format `'19 August, 2026'`, which `filters.ts` parses
 * against its own English month table and `compareCells` sorts lexicographically
 * — so the stored value has to stay English. `formatDate` below swaps the month
 * for its Turkish name **on the way to the screen only**, and leaves anything it
 * does not recognise exactly as it found it. Sorting, filtering, the clipboard
 * and the export all still see the stored string.
 */
import type { FilterOp } from './filters'
import type { NumericMetricKey } from './metrics'
import type { ColumnKey, RecordStatus, Season } from './types'

export type Locale = 'en' | 'tr'

/** Switch order, and the order the locale cycles in. */
export const LOCALES: readonly Locale[] = ['en', 'tr']

/**
 * Each language named in itself, never in the other. Someone who cannot read
 * the current locale is exactly the person reaching for this control, so
 * "Turkish" would be the one label they cannot use.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  tr: 'Türkçe',
}

/** The two-letter code the switch prints. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: 'EN',
  tr: 'TR',
}

/**
 * BCP-47 tags, for the three places a bare `'en'` / `'tr'` is not enough: the
 * root's `lang`, `Intl` number and percent formatting, and the collation and
 * case folding the search and the sort run on. Turkish case folding is not a
 * detail — `'İSTANBUL'.toLowerCase()` leaves a combining dot behind and stops
 * matching a typed `istanbul`, which `toLocaleLowerCase('tr-TR')` gets right.
 */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: 'en-GB',
  tr: 'tr-TR',
}

export const isLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value)

/* ------------------------------------------------------------------ *
 * The shape
 * ------------------------------------------------------------------ */

/**
 * A sentence with something rendered in the middle of it. English says
 * "Showing **1-8** of 24 entries" and Turkish says "24 kayittan **1-8**
 * gosteriliyor" — the same three parts in a different order, which a single
 * template string with a placeholder cannot express once the placeholder is an
 * element rather than text.
 */
export interface WrappedText {
  before: string
  after: string
}

export interface Strings {
  /** The locale this table belongs to — handy when passing it on to `Intl`. */
  locale: Locale

  /* ---- page head ---- */
  title: string
  kicker: string
  /** The switch's accessible name, and the group's. */
  language: string
  /** "Switch to Türkçe" — the accessible name of the segment not in use. */
  switchTo: (language: string) => string
  statTotal: string
  statMatching: string
  statSelected: string

  /* ---- toolbar ---- */
  searchPlaceholder: string
  searchLabel: string
  rowsTag: string
  decreaseRows: string
  increaseRows: string
  rowsPerPage: string
  newRecord: string
  /** The flow block's qualifier when a reading covers rows that are off screen. */
  allPages: string
  /**
   * The flow block's own name, and it exists only while the strip is too wide
   * to show at once. The readings themselves stay out of the accessibility tree
   * whatever the width — the live region says them — so this names an empty
   * group on purpose: what it is for is reaching the part that is off the edge.
   */
  flowStrip: string

  /* ---- the metric cog ---- */
  metricNumbers: string
  metricPanel: string
  /** Reads after the group name, in the accessible name only. */
  metricInUse: string
  metricHeld: string
  showingMetrics: (names: string) => string
  /**
   * The cog's whole accessible name: what the block is reading the selection as,
   * then what pressing this is for. One string rather than two joined at the
   * call site, because the join is a full stop in English and the second half
   * is a whole clause — neither survives being assembled by a caller that does
   * not know the language.
   */
  metricButton: (names: string) => string
  metric: Record<NumericMetricKey, string>
  /** `'Success'` → "Success rate" / "Başarılı oranı". */
  rateLabel: (option: string) => string
  /** The rate's working: "5 of 8" / "8 içinde 5". */
  rateNote: (hits: string, total: string) => string

  /* ---- the table head ---- */
  action: string
  selectAllOnPage: string
  dragColumn: string
  reorderColumn: (column: string) => string
  tripleClickColumn: (column: string) => string
  sortBy: (column: string) => string

  /* ---- rows ---- */
  toggleDetails: string
  dragRow: string
  reorderRow: (name: string, position: string) => string
  rowPosition: (index: number, total: number) => string
  selectRow: (name: string) => string
  editField: (column: string) => string
  setField: (column: string) => string
  doneEditing: string
  editRecord: string
  editRecordHint: string
  deleteRecord: string
  confirmDelete: string
  cancelDelete: string
  keepRecord: string
  saveRecord: string
  discardRecord: string

  /* ---- the detail pane ---- */
  paneRecordId: string
  paneOwner: string
  paneEmail: string
  panePlan: string
  paneActivity: string
  paneNote: string
  /** Seeded into a new record's detail fields, in the locale it was made in. */
  draftOwner: string
  draftActivity: string
  draftPlan: string

  /* ---- the empty state ---- */
  emptyTitle: string
  emptyBody: string

  /* ---- the footer ---- */
  footCount: (total: number) => WrappedText
  exportLabel: string
  /**
   * The pager's landmark name, and the four names behind its arrows. The
   * buttons print « ‹ › », which have no accessible name of their own — a
   * screen reader announces an unlabelled one as "button" and a braille display
   * shows the glyph, so the words have to come from here.
   */
  pagination: string
  firstPage: string
  prevPage: string
  nextPage: string
  lastPage: string
  /** A numbered button's name: the bare digit does not say what it counts. */
  pageNumber: (page: number, total: number) => string
  exporting: string
  exportNameLabel: string
  saveFile: (name: string) => string
  cancelExport: string

  /* ---- the filter dock ---- */
  dock: string
  revert: string
  addFilter: string
  addColumnFilter: string
  /** The dock's one-line invitation, shown only while it holds no chips. */
  dockEmpty: string
  removeFilter: (column: string) => string
  filterDialog: (column: string) => string
  filterValues: (column: string) => string
  filterValue: (column: string) => string
  rangeStart: (column: string) => string
  rangeEnd: (column: string) => string
  opTag: string
  from: string
  to: string
  value: string
  clear: string
  done: string
  /** The chip's value text while it has no operand yet. */
  any: string
  noneOf: (list: string) => string
  /**
   * The whole `between` clause, operator included — the one condition whose
   * shape is not "operator then operand". English leads with the operator and
   * joins with a conjunction; Turkish ends with a postposition, so there is no
   * operator word to put first and no slot a shared template could leave for it.
   */
  betweenText: (from: string, to: string) => string
  ops: Record<FilterOp, string>

  /* ---- the words behind the data ---- */
  columns: Record<ColumnKey, string>
  status: Record<RecordStatus, string>
  season: Record<Season, string>
  /** In stored order, January first — the index is the month number. */
  months: readonly string[]

  /* ---- the live region ---- */
  rowMoved: (name: string, position: number, total: number) => string
  columnMoved: (column: string, position: number, total: number) => string
  cellSelected: (column: string, row: number, total: number) => string
  rangeSelected: (rows: number, cols: number, cells: number) => string
  columnSelected: (column: string, cells: number, pages: number) => string
  copied: (cells: number) => string
  copyRefused: string
  preparingExport: (cells: number) => string
  exportReady: string
  exportSaved: (name: string) => string
  downloadRefused: string
  exportCancelled: string
  languageSet: (language: string) => string
}

/* ------------------------------------------------------------------ *
 * English
 * ------------------------------------------------------------------ */

/**
 * The default, and the reference. Every string here is the one that was written
 * inline before this file existed — changing the wording of one is a change to
 * the screen, not a translation detail, so it belongs in a commit that says so.
 */
export const EN: Strings = {
  locale: 'en',

  title: 'Data table',
  kicker: 'Records / Directory',
  language: 'Language',
  switchTo: (language) => `Switch to ${language}`,
  statTotal: 'Total',
  statMatching: 'Matching',
  statSelected: 'Selected',

  searchPlaceholder: 'Search name, email or address',
  searchLabel: 'Search records',
  rowsTag: 'Rows',
  decreaseRows: 'Decrease rows per page',
  increaseRows: 'Increase rows per page',
  rowsPerPage: 'Rows per page',
  newRecord: 'New record',
  allPages: 'all pages',
  flowStrip: 'What the selection reads as — scroll for the rest',

  metricNumbers: 'Numbers',
  metricPanel: 'What each kind of cell selection reads as',
  metricInUse: ' — in use for this selection',
  metricHeld: 'The last one on has to stay on',
  showingMetrics: (names) => `Showing ${names}`,
  metricButton: (names) =>
    `Showing ${names}. Set what each kind of cell selection reads as.`,
  metric: {
    sum: 'Sum',
    product: 'Product',
    mean: 'Mean',
    median: 'Median',
    highest: 'Highest',
    lowest: 'Lowest',
  },
  rateLabel: (option) => `${option} rate`,
  rateNote: (hits, total) => `${hits} of ${total}`,

  action: 'Action',
  selectAllOnPage: 'Select all rows on this page',
  dragColumn: 'Drag to reorder the column, or into the filter dock to filter by it',
  reorderColumn: (column) =>
    `Reorder ${column} column. Hold Alt and press Arrow Left or Arrow Right to move it. ` +
    `To filter by it, drag it into the filter dock or use the dock's Add filter button.`,
  tripleClickColumn: (column) => `Triple click to select the whole ${column} column`,
  sortBy: (column) => `Sort by ${column}`,

  toggleDetails: 'Toggle details',
  dragRow: 'Drag to reorder row',
  reorderRow: (name, position) =>
    `Reorder ${name}, ${position}. Hold Alt and press Arrow Up or Arrow Down to move it.`,
  rowPosition: (index, total) => `row ${index} of ${total}`,
  selectRow: (name) => `Select ${name}`,
  editField: (column) => `Edit ${column}`,
  setField: (column) => `Set ${column}`,
  doneEditing: 'Done editing',
  editRecord: 'Edit record',
  editRecordHint: 'Edit record — then pick a field',
  deleteRecord: 'Delete record',
  confirmDelete: 'Confirm delete',
  cancelDelete: 'Cancel delete',
  keepRecord: 'Keep this record',
  saveRecord: 'Save record',
  discardRecord: 'Discard record',

  paneRecordId: 'Record ID',
  paneOwner: 'Owner',
  paneEmail: 'Email',
  panePlan: 'Plan',
  paneActivity: 'Last activity',
  paneNote: 'Note',
  draftOwner: 'Unassigned',
  draftActivity: 'Just now',
  draftPlan: 'Standard',

  emptyTitle: 'No records match',
  emptyBody: 'Clear the search field, or loosen a filter in the dock above.',

  footCount: (total) => ({ before: 'Showing ', after: ` of ${total} entries` }),
  exportLabel: 'Export',
  pagination: 'Pagination',
  firstPage: 'First page',
  prevPage: 'Previous page',
  nextPage: 'Next page',
  lastPage: 'Last page',
  pageNumber: (page, total) => `Page ${page} of ${total}`,
  exporting: 'Exporting',
  exportNameLabel: 'Name the exported CSV file',
  saveFile: (name) => `Save ${name}`,
  cancelExport: 'Cancel the export',

  dock: 'Filter dock',
  revert: 'Revert — remove every filter',
  addFilter: 'Add filter',
  addColumnFilter: 'Add a column filter',
  dockEmpty: 'Drag a column here by its ⠿ grip to filter by it.',
  removeFilter: (column) => `Remove the ${column} filter`,
  filterDialog: (column) => `${column} filter`,
  filterValues: (column) => `${column} values`,
  filterValue: (column) => `${column} value`,
  rangeStart: (column) => `${column} range start`,
  rangeEnd: (column) => `${column} range end`,
  opTag: 'Is',
  from: 'From',
  to: 'To',
  value: 'Value',
  clear: 'Clear',
  done: 'Done',
  any: 'Any',
  noneOf: (list) => `None of: ${list}`,
  betweenText: (from, to) => `is between ${from} and ${to}`,
  ops: {
    contains: 'contains',
    notContains: 'does not contain',
    is: 'is',
    startsWith: 'starts with',
    gte: 'is at least',
    lte: 'is at most',
    gt: 'is over',
    lt: 'is under',
    between: 'is between',
    on: 'is on',
    before: 'is before',
    after: 'is after',
    isAnyOf: 'is any of',
    isNoneOf: 'is none of',
  },

  columns: {
    name: 'Name',
    date: 'Date',
    status: 'Status',
    solvedCases: 'Solved cases',
    favouriteSeason: 'Favourite season',
    address: 'Address',
  },
  status: {
    Success: 'Success',
    'In progress': 'In progress',
    Failed: 'Failed',
  },
  season: {
    Spring: 'Spring',
    Summer: 'Summer',
    Autumn: 'Autumn',
    Winter: 'Winter',
  },
  months: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],

  rowMoved: (name, position, total) => `${name} moved to position ${position} of ${total}.`,
  columnMoved: (column, position, total) =>
    `${column} column moved to position ${position} of ${total}.`,
  cellSelected: (column, row, total) => `${column}, row ${row} of ${total} selected.`,
  rangeSelected: (rows, cols, cells) =>
    `${rows} row${rows === 1 ? '' : 's'} by ${cols} column${cols === 1 ? '' : 's'} ` +
    `selected, ${cells} cells.`,
  columnSelected: (column, cells, pages) =>
    `${column} column selected, ${cells} cell${cells === 1 ? '' : 's'}` +
    (pages > 1 ? ` across ${pages} pages.` : '.'),
  copied: (cells) => `Copied ${cells} cell${cells === 1 ? '' : 's'} to the clipboard.`,
  copyRefused: 'The browser refused the copy.',
  preparingExport: (cells) => `Preparing ${cells} cell${cells === 1 ? '' : 's'} for export.`,
  exportReady: 'Export ready. Name the file and press Enter to save it.',
  exportSaved: (name) => `Saved ${name}.`,
  downloadRefused: 'The browser refused the download.',
  exportCancelled: 'Export cancelled.',
  languageSet: (language) => `Language set to ${language}.`,
}

/* ------------------------------------------------------------------ *
 * Turkish
 * ------------------------------------------------------------------ */

/**
 * Two habits of the language do most of the work here, and both make the
 * strings *simpler* than their English counterparts rather than harder:
 *
 * - **No plural after a numeral.** "3 satır", not "3 satırlar". Every
 *   `cell${n === 1 ? '' : 's'}` in the English above is just the noun here.
 * - **Verb last.** Which is why the sentences are not the English word order
 *   with the words swapped: "Showing 1-8 of 24 entries" is "24 kayıttan 1-8
 *   gösteriliyor", and the interpolated part lands in a different place. That
 *   is what `WrappedText` is for.
 *
 * Suffixes are written out rather than derived. Turkish vowel harmony would
 * need the stem's last vowel to pick between `-de`/`-da` and `-i`/`-ı`/`-u`/`-ü`,
 * and a helper that got it right for the six column names in this table would
 * still be wrong for the seventh a host adds. So where a suffix would have had
 * to attach to an interpolated name, the phrasing avoids needing one at all —
 * "Sütunu sırala: Ad" rather than "Ad'ı sırala".
 */
export const TR: Strings = {
  locale: 'tr',

  title: 'Veri Tablosu',
  kicker: 'Kayıtlar / Dizin',
  language: 'Dil',
  switchTo: (language) => `${language} diline geç`,
  statTotal: 'Toplam',
  statMatching: 'Eşleşen',
  statSelected: 'Seçili',

  searchPlaceholder: 'Ad, e-posta veya adres ara',
  searchLabel: 'Kayıtlarda ara',
  rowsTag: 'Satır',
  decreaseRows: 'Sayfa başına satır sayısını azalt',
  increaseRows: 'Sayfa başına satır sayısını artır',
  rowsPerPage: 'Sayfa başına satır',
  newRecord: 'Yeni kayıt',
  allPages: 'tüm sayfalar',
  flowStrip: 'Seçimin nasıl okunduğu — gerisi için kaydırın',

  metricNumbers: 'Sayılar',
  metricPanel: 'Her hücre seçimi türünün nasıl okunacağı',
  metricInUse: ' — bu seçim için kullanılıyor',
  metricHeld: 'Açık kalan son seçenek kapatılamaz',
  showingMetrics: (names) => `Gösterilen: ${names}`,
  metricButton: (names) =>
    `Gösterilen: ${names}. Her hücre seçimi türünün nasıl okunacağını ayarlayın.`,
  metric: {
    sum: 'Toplam',
    product: 'Çarpım',
    mean: 'Ortalama',
    median: 'Ortanca',
    highest: 'En yüksek',
    lowest: 'En düşük',
  },
  rateLabel: (option) => `${option} oranı`,
  rateNote: (hits, total) => `${total} içinde ${hits}`,

  action: 'İşlem',
  selectAllOnPage: 'Bu sayfadaki tüm satırları seç',
  dragColumn: 'Sütunu sıralamak için sürükleyin, filtrelemek için filtre rayına bırakın',
  reorderColumn: (column) =>
    `Sütunu taşı: ${column}. Alt tuşunu basılı tutup Sol Ok veya Sağ Ok ile taşıyın. ` +
    `Bu sütuna göre filtrelemek için sütunu filtre rayına sürükleyin ya da rayın ` +
    `Filtre ekle düğmesini kullanın.`,
  tripleClickColumn: (column) => `Sütunun tamamını seçmek için üç kez tıklayın: ${column}`,
  sortBy: (column) => `Sütunu sırala: ${column}`,

  toggleDetails: 'Ayrıntıları aç/kapat',
  dragRow: 'Satırı sıralamak için sürükleyin',
  reorderRow: (name, position) =>
    `Satırı taşı: ${name}, ${position}. Alt tuşunu basılı tutup Yukarı Ok veya ` +
    `Aşağı Ok ile taşıyın.`,
  rowPosition: (index, total) => `${total} satırdan ${index}.`,
  selectRow: (name) => `Seç: ${name}`,
  editField: (column) => `Düzenle: ${column}`,
  setField: (column) => `Ayarla: ${column}`,
  doneEditing: 'Düzenlemeyi bitir',
  editRecord: 'Kaydı düzenle',
  editRecordHint: 'Kaydı düzenle — sonra bir alan seçin',
  deleteRecord: 'Kaydı sil',
  confirmDelete: 'Silmeyi onayla',
  cancelDelete: 'Silmekten vazgeç',
  keepRecord: 'Bu kaydı koru',
  saveRecord: 'Kaydı kaydet',
  discardRecord: 'Kaydı at',

  paneRecordId: 'Kayıt no',
  paneOwner: 'Sorumlu',
  paneEmail: 'E-posta',
  panePlan: 'Plan',
  paneActivity: 'Son işlem',
  paneNote: 'Not',
  draftOwner: 'Atanmadı',
  draftActivity: 'Az önce',
  draftPlan: 'Standart',

  emptyTitle: 'Eşleşen kayıt yok',
  emptyBody: 'Arama alanını temizleyin ya da yukarıdaki raydaki bir filtreyi gevşetin.',

  footCount: (total) => ({ before: `${total} kayıttan `, after: ' gösteriliyor' }),
  exportLabel: 'Dışa aktar',
  pagination: 'Sayfalama',
  firstPage: 'İlk sayfa',
  prevPage: 'Önceki sayfa',
  nextPage: 'Sonraki sayfa',
  lastPage: 'Son sayfa',
  pageNumber: (page, total) => `${total} sayfadan ${page}.`,
  exporting: 'Dışa aktarılıyor',
  exportNameLabel: 'Dışa aktarılan CSV dosyasını adlandırın',
  saveFile: (name) => `Kaydet: ${name}`,
  cancelExport: 'Dışa aktarmayı iptal et',

  dock: 'Filtre rayı',
  revert: 'Geri al — tüm filtreleri kaldır',
  addFilter: 'Filtre ekle',
  addColumnFilter: 'Sütun filtresi ekle',
  dockEmpty: 'Filtrelemek için bir sütunu ⠿ tutamağından buraya sürükleyin.',
  removeFilter: (column) => `Filtreyi kaldır: ${column}`,
  filterDialog: (column) => `Filtre: ${column}`,
  filterValues: (column) => `Değerler: ${column}`,
  filterValue: (column) => `Değer: ${column}`,
  rangeStart: (column) => `Aralık başlangıcı: ${column}`,
  rangeEnd: (column) => `Aralık sonu: ${column}`,
  opTag: 'Koşul',
  from: 'Başlangıç',
  to: 'Bitiş',
  value: 'Değer',
  clear: 'Temizle',
  done: 'Bitti',
  any: 'Hepsi',
  noneOf: (list) => `Hiçbiri: ${list}`,
  betweenText: (from, to) => `${from} ile ${to} arasında`,
  /**
   * Phrased to read left to right after the column name the chip already
   * prints, exactly as the English table is: the chip says "AD" and then
   * "içerir", so the pair reads "Ad içerir".
   */
  ops: {
    contains: 'içerir',
    notContains: 'içermez',
    is: 'eşittir',
    startsWith: 'ile başlar',
    gte: 'en az',
    lte: 'en fazla',
    gt: 'büyüktür',
    lt: 'küçüktür',
    between: 'arasında',
    on: 'tarihinde',
    before: 'tarihinden önce',
    after: 'tarihinden sonra',
    isAnyOf: 'şunlardan biri',
    isNoneOf: 'şunlardan hiçbiri',
  },

  columns: {
    name: 'Ad',
    date: 'Tarih',
    status: 'Durum',
    solvedCases: 'Çözülen vaka',
    favouriteSeason: 'Favori mevsim',
    address: 'Adres',
  },
  status: {
    Success: 'Başarılı',
    'In progress': 'Devam ediyor',
    Failed: 'Başarısız',
  },
  season: {
    Spring: 'İlkbahar',
    Summer: 'Yaz',
    Autumn: 'Sonbahar',
    Winter: 'Kış',
  },
  months: [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
  ],

  rowMoved: (name, position, total) =>
    `${name} ${total} satırdan ${position}. sıraya taşındı.`,
  columnMoved: (column, position, total) =>
    `${column} sütunu ${total} sütundan ${position}. sıraya taşındı.`,
  cellSelected: (column, row, total) => `${column}, ${total} satırdan ${row}. seçildi.`,
  rangeSelected: (rows, cols, cells) =>
    `${rows} satır ${cols} sütun seçildi, ${cells} hücre.`,
  columnSelected: (column, cells, pages) =>
    `${column} sütunu seçildi, ${cells} hücre` +
    (pages > 1 ? `, ${pages} sayfa boyunca.` : '.'),
  copied: (cells) => `${cells} hücre panoya kopyalandı.`,
  copyRefused: 'Tarayıcı kopyalamayı reddetti.',
  preparingExport: (cells) => `${cells} hücre dışa aktarılmak üzere hazırlanıyor.`,
  exportReady: 'Dışa aktarma hazır. Dosyayı adlandırıp Enter tuşuna basın.',
  exportSaved: (name) => `${name} kaydedildi.`,
  downloadRefused: 'Tarayıcı indirmeyi reddetti.',
  exportCancelled: 'Dışa aktarma iptal edildi.',
  languageSet: (language) => `Dil ${language} olarak ayarlandı.`,
}

export const STRINGS: Record<Locale, Strings> = { en: EN, tr: TR }

/** The dictionary for a locale, falling back to English for anything unknown. */
export const stringsFor = (locale: Locale): Strings => STRINGS[locale] ?? EN

/* ------------------------------------------------------------------ *
 * Reading a data value in a locale
 * ------------------------------------------------------------------ */

/**
 * One enum cell's word. The value is the canonical English one; anything not in
 * the table — a host's own status, a value typed into a cell — comes back
 * untouched rather than blank, because an unrecognised value is still the
 * record's value and hiding it would be worse than leaving it in English.
 */
export function readEnum(t: Strings, column: ColumnKey, value: string): string {
  if (column === 'status') return t.status[value as RecordStatus] ?? value
  if (column === 'favouriteSeason') return t.season[value as Season] ?? value
  return value
}

/** Built once per locale: `'August'` → `'Ağustos'`, for `formatDate` below. */
const MONTH_MAPS: Record<Locale, ReadonlyMap<string, string>> = {
  en: new Map(),
  tr: new Map(EN.months.map((month, index) => [month.toLowerCase(), TR.months[index]])),
}

/**
 * A stored date as the locale reads it — `'19 August, 2026'` → `'19 Ağustos,
 * 2026'`. Display only: the string this was given is what still gets sorted,
 * filtered, copied and exported.
 *
 * Anything whose month is not one of the twelve English names falls straight
 * through. A host feeding this component ISO dates or its own format will see
 * them unchanged, which is the right answer — this is a swap of one known
 * vocabulary for another, not a date parser.
 */
export function formatDate(t: Strings, value: string): string {
  const map = MONTH_MAPS[t.locale]
  if (map.size === 0) return value
  return value.replace(/[A-Za-z]+/, (word) => map.get(word.toLowerCase()) ?? word)
}

/**
 * A cell's text as the locale reads it. The one place that knows which columns
 * carry a translatable vocabulary, so no caller has to name `status` or `date`
 * to render a row.
 */
export function readCell(t: Strings, column: ColumnKey, value: string): string {
  if (column === 'date') return formatDate(t, value)
  return readEnum(t, column, value)
}
