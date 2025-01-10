const config = (module.exports = {}); // https://stackoverflow.com/a/13574878/12031280

// Database
config.host = process.env.DATABASE_HOST;
config.user = process.env.DATABASE_USER;
config.password = process.env.DATABASE_PASSWORD;
config.database = process.env.DATABASE_NAME;
config.port = process.env.DATABASE_PORT;
config.ssl = true;

// Auth0
config.auth0 = {
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
};
