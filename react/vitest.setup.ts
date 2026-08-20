import '@testing-library/jest-dom/vitest'

// The bundled logo is a 13KB data URI; without this every failed query
// pretty-prints it and the assertion error takes seconds to build.
process.env.DEBUG_PRINT_LIMIT = '3000'
