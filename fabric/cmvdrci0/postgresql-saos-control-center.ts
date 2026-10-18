import pg from 'pg-promise';

const pgp = pg();

export class PgMultiTierQuery {
  private db: any;

  constructor(connectionString: string) {
    this.db = pgp(connectionString);
  }

  async tierOne(query: string, values: any[] = []): Promise<any[]> {
    try {
      return await this.db.any(query, values);
    } catch (error) {
      console.error('TierOne query failed:', error.message);
      throw new Error('Failed to execute tier-one query');
    }
  }

  async tierTwo(baseQuery: string, paramExtractor: (row: any) => any[], secondaryQuery: string): Promise<any[][]> {
    try {
      const baseResults = await this.tierOne(baseQuery);
      const promises = baseResults.map(row => {
        const values = paramExtractor(row);
        return this.tierOne(secondaryQuery, values);
      });
      return await Promise.all(promises);
    } catch (error) {
      console.error('TierTwo query failed:', error.message);
      throw new Error('Failed to execute tier-two queries');
    }
  }

  async tierThree(
    baseQuery: string,
    paramExtractor: (row: any) => any[],
    secondaryQuery: string,
    aggregator: (tierTwoResults: any[][]) => Promise<any>
  ): Promise<any> {
    try {
      const tierTwoResults = await this.tierTwo(baseQuery, paramExtractor, secondaryQuery);
      return await aggregator(tierTwoResults);
    } catch (error) {
      console.error('TierThree query failed:', error.message);
      throw new Error('Failed to execute tier-three aggregation');
    }
  }

  async close(): Promise<void> {
    await this.db.$pool.end();
  }
}
