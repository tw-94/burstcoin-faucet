var faucet_codes = require('voucher-code-generator');
var faucetConfig = require('./faucetConfig');
var codes = [];
codes = faucet_codes.generate({
    length: faucetConfig.faucetCodeLength,
    count:  faucetConfig.faucetCodeCount,
    prefix: faucetConfig.faucetCodePrefix,
    postfix: faucetConfig.faucetCodePostfix,
});
module.exports = {
  getFaucetCodes: function() {
    return codes;
  }
}
