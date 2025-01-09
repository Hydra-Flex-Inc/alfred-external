// Instantiate SendGrid mail client
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.AzureWebJobsSendGridApiKey);

// TODO remove duplicate code determining Azure Functions Environment.
const azureFunctionsEnvironment =
  process.env.AZURE_FUNCTIONS_ENVIRONMENT !== "Development" &&
  process.env.WEBSITE_INSTANCE_ID
    ? "production"
    : "development";

const config = {
  fromName: process.env.MAIL_FROM_NAME || "Alfred by Hydra-Flex",
  fromEmail: process.env.MAIL_FROM_EMAIL || "alfred@hydraflexinc.com",
  environment: process.env.MAIL_ENVIRONMENT || azureFunctionsEnvironment, // Use mail environment, if specified, otherwise use function app environment.
  nonProductionEmail:
    process.env.MAIL_NON_PRODUCTION_EMAIL || "alfred@hydraflexinc.com",
  templateIds: {
    emailVerification: "d-e508982f86734624a14603c5374d7973", // Email Verification Template.
  },
};

// Any time we are about to specify an email recipient (to, cc, bcc) utilize this function.
const prepareRecipient = (email) => {
  if (config.environment !== "production") {
    return config.nonProductionEmail;
  } else {
    return email;
  }
};

// Wrapper for the sendgrid send method, allowing us to override or insert some
// fields on the message according to the current config.
// https://sendgrid.api-docs.io/v3.0/mail-send/v3-mail-send
const send = (message) => {
  const defaultSender = {
    name: config.fromName,
    email: config.fromEmail,
  };
  const personalizationFromExists = message.personalizations.some(
    (p) => p.from
  );

  for (const personalization of message.personalizations) {
    // If from is not set, but other personalizations have a from, set the from to the default sender.
    if (!personalization.from && personalizationFromExists) {
      personalization.from = defaultSender;
    }

    // Replace recipient email addresses with the developer's email address if we are in non-prod mode.
    if (config.environment !== "production") {
      // Will error out if a "from" recipient is repeated in "cc" or "bcc", so simply set these to null.
      personalization.cc = personalization.bcc = null;

      // Use the non-prod email rather than the specified email. Keep the name on the first "to" recipient.
      const to = personalization.to.shift();
      to.email = config.nonProductionEmail; // Change the email on the first recipient.
      personalization.to = [to]; // This removes all but the first recipient.
    }
  }

  // Set "From" to the default sender, if not specified anywhere in the message.
  if (!message.from && !personalizationFromExists) {
    message.from = defaultSender;
  }

  return sgMail.send(message);
};

module.exports = {
  // Variables
  config,
  sendGridInstance: sgMail, // provide access to the SendGrid instance for direct access to any non-wrapped methods we may want to utilize.

  // Functions
  prepareRecipient,
  send,
};
