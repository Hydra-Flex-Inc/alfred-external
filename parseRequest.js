const parse = (req) => {
  req.headers.forEach((value, name) => {
    if (name === "cookie") {
      req.headers.cookie = value;
    }
  });
  req.query = Object.fromEntries(req.query.entries());
  return req;
};

module.exports = {
  parse,
};
