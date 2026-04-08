const fs = require('fs');
const path = require('path');
const pool = require('../db');

async function syncStocks() {
  const jsonPath = path.join(__dirname, '../../idxstocks_filtered.json');
  
  if (!fs.existsSync(jsonPath)) {
    console.error(`File not found: ${jsonPath}`);
    process.exit(1);
  }

  console.log('Reading idxstocks_filtered.json...');
  const stocksData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Found ${stocksData.length} stocks in JSON.`);

  const client = await pool.connect();
  try {
    console.log('Starting sync transaction...');
    await client.query('BEGIN');

    let updatedCount = 0;

    for (const stock of stocksData) {
      const query = `
        INSERT INTO public.stocks (
          code, name, sector, sub_sector, industry, sub_industry, index_type, updated_at
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (code) 
        DO UPDATE SET
          name = EXCLUDED.name,
          sector = EXCLUDED.sector,
          sub_sector = EXCLUDED.sub_sector,
          industry = EXCLUDED.industry,
          sub_industry = EXCLUDED.sub_industry,
          index_type = EXCLUDED.index_type,
          updated_at = NOW();
      `;

      const values = [
        stock.code,
        stock.company_name,
        stock.sector,
        stock.subsector,
        stock.industry,
        stock.subindustry,
        stock.index_type
      ];

      await client.query(query, values);
      updatedCount++;
      
      if (updatedCount % 100 === 0) {
        console.log(`Synced ${updatedCount}/${stocksData.length} stocks...`);
      }
    }

    await client.query('COMMIT');
    console.log(`Successfully synchronized ${updatedCount} stocks.`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during synchronization:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

syncStocks();
