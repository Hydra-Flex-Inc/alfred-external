const parseRequest = (req) => {
  // If a cookie exists, set it on the headers object
  req.headers.forEach((value, name) => {
    if (name === "cookie") {
      req.headers.cookie = value;
    }
  });

  // Parse the query string into an object
  req.query = Object.fromEntries(req.query.entries());

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
