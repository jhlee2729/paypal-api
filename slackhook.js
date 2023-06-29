const Slack = require('slack-node');
require('dotenv').config();
const webhookUri = process.env.WEB_HOOK_URI;
const slack = new Slack();
slack.setWebhook(webhookUri);

const send = async(country, message, callback) => {

    slack.webhook({
        channel: "#error-paypal-api", // 전송될 슬랙 채널
        username: "paypal-api", //슬랙에 표시될 이름
        text: country + ' - ' + JSON.stringify(message)
    }, callback);
}


module.exports = send;