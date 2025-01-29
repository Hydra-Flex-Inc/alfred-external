const parseRequest = (req) => {
  req.req_headers = {};
  req.headers.forEach((value, name) => {
    req.req_headers[name] = value;
  });

  // Parse the query string into an object
  req.req_query = {};
  req.req_query = Object.fromEntries(req.query.entries());

  return req;
};

const generateRandomMac = () => {
  const out = [];
  for (let i = 0; i < 6; i++) {
    out.push(
      `${Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, "0")}`
    );
  }
  return out.join(":").toLowerCase();
};

module.exports = {
  parseRequest,
  generateRandomMac,
};
