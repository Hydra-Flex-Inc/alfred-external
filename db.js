/* eslint-disable space-before-function-paren */
// per guidance from https://node-postgres.com/guides/project-structure
const pg = require("pg");

pg.types.setTypeParser(20, (value) => +value); // https://github.com/vitaly-t/pg-promise/wiki/BigInt
pg.types.setTypeParser(1700, (value) => +value);

const pool = new pg.Pool();

const tsdbPool = new pg.Pool({
  host: process.env.TSDBHOST,
  user: process.env.TSDBUSER,
  password: process.env.TSDBPASSWORD,
  database: process.env.TSDBDATABASE,
  port: process.env.TSDBPORT,
});

module.exports = {
  async query(text, params) {
    return await pool.query(text, params);
  },

  async tsdbQuery(text, params) {
    return await tsdbPool.query(text, params);
  },

  async getClient() {
    const client = await pool.connect();
    const query = client.query;
    const release = client.release;

    // set a timeout of 5 seconds, after which we will log this client's last query
    const timeout = setTimeout(() => {
      console.error("A client has been checked out for more than 5 seconds!");
      console.error(
        `The last executed query on this client was: ${client.lastQuery}`
      );
    }, 5000);

    // monkey patch the query method to keep track of the last query executed
    client.query = (...args) => {
      client.lastQuery = args;
      return query.apply(client, args);
    };

    client.release = () => {
      // clear our timeout
      clearTimeout(timeout);

      // set the methods back to their old un-monkey-patched version
      client.query = query;
      client.release = release;
      return release.apply(client);
    };

    return client;
  },

  async getTSDBClient() {
    const client = await tsdbPool.connect();
    const query = client.query;
    const release = client.release;

    // set a timeout of 5 seconds, after which we will log this client's last query
    const timeout = setTimeout(() => {
      console.error("A client has been checked out for more than 5 seconds!");
      console.error(
        `The last executed query on this client was: ${client.lastQuery}`
      );
    }, 5000);

    // monkey patch the query method to keep track of the last query executed
    client.query = (...args) => {
      client.lastQuery = args;
      return query.apply(client, args);
    };

    client.release = () => {
      // clear our timeout
      clearTimeout(timeout);

      // set the methods back to their old un-monkey-patched version
      client.query = query;
      client.release = release;
      return release.apply(client);
    };

    return client;
  },
};
