import * as XLSX from 'xlsx'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..')

// ── Column headers (in order) ─────────────────────────────────────────────────
const HEADERS = [
  'Item Name',
  'Brand',
  'Size',
  'Season',
  'Status',
  'Consignee',
  'Cost',
  'Take-back Price',
  'Listed Price',
  'Notes',
]

// ── Season reference (add as a second sheet) ──────────────────────────────────
const SEASON_REF = [
  ['Code',   'Means'],
  ['SS23',   'Spring/Summer 2023'],
  ['AW22',   'Autumn/Winter 2022'],
  ['R23',    'Resort 2023'],
  ['PF21',   'Pre-Fall 2021'],
  ['',       '(blank) = no known season'],
]

// ── Status reference ──────────────────────────────────────────────────────────
const STATUS_REF = [
  ['Value',             'Meaning'],
  ['in_stock',          'Default — item is available'],
  ['sold',              'Item has been sold'],
  ['reserved',          'Held for someone'],
  ['returned',          'Clawed back by the consignee'],
  ['on_rental',         'Out on loan'],
  ['out_for_cleaning',  'At the cleaner'],
  ['archived',          'No longer active'],
]

// ── Test data (10 rows) ───────────────────────────────────────────────────────
// Uses a mix of seeded brands (Undercover, CDG, Raf Simons, Helmut Lang…)
// and new brands (Acne Studios, Stone Island) to test auto-creation.
const TEST_ROWS = [
  // name,                                     brand,                  size,  season, status,     consignee,    cost,   takeback, listed,  notes
  ['AW11 Undercover "Scab" Motorcycle Jacket', 'Undercover',           'L',   'AW11', 'in_stock', '',           '1200', '1800',   '2400',  'Light wear on collar'],
  ['SS01 Helmut Lang Astro Parka',             'Helmut Lang',          'M',   'SS01', 'in_stock', '',           '950',  '',       '1600',  ''],
  ['AW05 Raf Simons Consumed Bomber',          'Raf Simons',           '48',  'AW05', 'sold',     '',           '2800', '',       '',      'Sold to client — Tokyo'],
  ['SS18 CDG Homme Plus Tuxedo Blazer',        'Comme des Garçons Homme Plus', 'S', 'SS18', 'reserved', 'Acme Store', '600', '900', '1200', ''],
  ['AW10 Undercover x Nike Gyakusou Jacket',   'Undercover, Nike',     'XL',  'AW10', 'in_stock', '',           '480',  '650',    '900',   'Nike collab capsule'],
  ['Resort 22 Yohji Yamamoto Pleated Trousers','Yohji Yamamoto',       '3',   'R22',  'in_stock', '',           '720',  '',       '1100',  ''],
  ['Pre-Fall 20 Maison Margiela Tabi Boots',   'Maison Margiela',      '42',  'PF20', 'in_stock', '',           '1100', '1400',   '1900',  'EU 42 / UK 8'],
  ['AW22 Acne Studios Mohair Cardigan',        'Acne Studios',         'S',   'AW22', 'in_stock', 'Oji Shop',   '390',  '500',    '680',   'New brand — will be created'],
  ['SS23 Stone Island Nylon Shell Jacket',     'Stone Island',         'L',   'SS23', 'in_stock', '',           '550',  '',       '820',   ''],
  ['Helmut Lang Archive Painter Jeans',        'Helmut Lang',          '32',  '',     'in_stock', '',           '430',  '580',    '750',   'No known season'],
]

// ─────────────────────────────────────────────────────────────────────────────

function makeWorkbook(rows) {
  const wb = XLSX.utils.book_new()

  // Main sheet
  const wsData = [HEADERS, ...rows]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Column widths
  ws['!cols'] = [
    { wch: 48 }, // Item Name
    { wch: 36 }, // Brand
    { wch: 8  }, // Size
    { wch: 8  }, // Season
    { wch: 14 }, // Status
    { wch: 18 }, // Consignee
    { wch: 10 }, // Cost
    { wch: 14 }, // Take-back Price
    { wch: 12 }, // Listed Price
    { wch: 36 }, // Notes
  ]

  XLSX.utils.book_append_sheet(wb, ws, 'Items')

  // Reference sheet
  const refWs = XLSX.utils.aoa_to_sheet([
    ['SEASON CODES'],
    ...SEASON_REF,
    [],
    ['STATUS VALUES'],
    ...STATUS_REF,
  ])
  refWs['!cols'] = [{ wch: 20 }, { wch: 36 }]
  XLSX.utils.book_append_sheet(wb, refWs, 'Reference')

  return wb
}

// Template (headers only)
const templateWb = makeWorkbook([])
XLSX.writeFile(templateWb, join(OUT, 'UGIS Import Template.xlsx'))
console.log('✓ Created: UGIS Import Template.xlsx')

// Test file (with sample rows)
const testWb = makeWorkbook(TEST_ROWS)
XLSX.writeFile(testWb, join(OUT, 'UGIS Test Import.xlsx'))
console.log('✓ Created: UGIS Test Import.xlsx')

console.log('\nColumn mapping:')
HEADERS.forEach(h => console.log(`  "${h}" → auto-detected`))
