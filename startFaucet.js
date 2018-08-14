var jsonMarkup = require('json-markup');
var jsonFormat = require('prettyjson');
var url = require('url');
var request = require('request');
var compression = require('compression');
var express = require('express');
var httpProxy = require('http-proxy');
var path = require('path');
var http = require('http');
var bodyParser = require('body-parser');
var io = require('socket.io')();
var ioSocket = null;
var RateLimit = require('express-rate-limit');
var lruRateLimit = require('ratelimit-lru');
var getJSON = require('get-json');
var fs = require('fs');
//new usage (express-recaptcha version >= 4.*.*)
var faucetConfig = require('./faucetConfig');
var faucetCodes = require('./faucetCodes');
var Recaptcha = require('express-recaptcha').Recaptcha;
//import Recaptcha from 'express-recaptcha'
var recaptcha = new Recaptcha(faucetConfig.googlePublicKey, faucetConfig.googlePrivateKey);
var errorCode = ''
var errorMessage = '';
var errorMessage2 = '';
var errorMessage3 = '';
var balances = '';

//Initialize Faucet Codes
if (faucetConfig.faucetUseCodes) {
    generateCodes();
}
//Initialize Faucet Webserver
initWebserver();
//Code Array
var codes = [];
//Get New Faucet Codes
function generateCodes() {
    var url = '';
    codes = faucetCodes.getFaucetCodes();
    if (faucetConfig.faucetCodesPublic) {
        url = `./client/${faucetConfig.faucetFileName}.csv`;
    } else {
        url = `${faucetConfig.faucetFileName}.csv`;
    }
    //Clean File By Initialize
    fs.writeFile(url, '', function() {})
    //Append File with Iteration
    for (var i in codes) {
        console.log(codes[i]);
        fs.appendFile(url, codes[i] + "\r\n", 'utf8', function(err) {
            if (err) {
                console.log(err);
            }
        });
    }
}

function initWebserver() {
    var app = express();
    app.set('view engine', 'ejs');

    app.use(express.static(path.join(__dirname, 'client')));
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({
        extended: true
    }));

    var createAccountLimiter = new RateLimit({
        windowMs: 24 * 60 * 60 * 1000, // 24 hours window
        delayAfter: faucetConfig.maxRequest * 3, // begin slowing down responses after certain value (Factor 3)
        delayMs: 3 * 1000, // slow down subsequent responses by 3 seconds per request
        max: faucetConfig.maxRequest * 3, // start blocking after certain value (Factor 3)
        message: "Too many account attempts from this IP, please try again after a day"
    });

    app.use(createAccountLimiter);
    app.get('/', function(req, res) {
        res.render('error', {
            error: 'Form was manipulated'
        });
    });

    app.post('/', createAccountLimiter, function(req, res) {
        recaptcha.verify(req, function(error, data) {
            //TO-DO Change later
            if (!error) {
                var value = getAccountBalance(faucetConfig.faucetAccount);
                if (!faucetConfig.faucetUseCodes) {
                    res.render('index', {
                        error: errorMessage,
                        balance: errorMessage2,
                        status: errorMessage3,
                        donate: faucetConfig.faucetAccountDonation,
                    })
                } else {
                    //Test Redirection
                    res.render('code', {
                        error: errorMessage,
                        balance: errorMessage2,
                        status: errorMessage3,
                        donate: faucetConfig.faucetAccountDonation,
                    })
                }
                res.end();
            } else {
                res.render('error', {
                    error: 'reCAPTCHA validation failed'
                });
                res.end();
            }
        })
    });
    app.post('/burst', createAccountLimiter, function(req, res) {
        console.log("1 | Requested Account: " + req.body.name);
        checkWallet(req.body.name);
        res.render('index', {
            error: errorMessage,
            balance: errorMessage2,
            status: errorMessage3,
            donate: faucetConfig.faucetAccountDonation,
        })
        done();
    });

    app.post('/code', createAccountLimiter, function(req, res) {
        console.log("1 | Requested Account: " + req.body.name);
        var verifyCode = false;
        var codesList = faucetCodes.getFaucetCodes();

        for (var i in codesList) {
            if (strCompare(codesList[i], req.body.code) == "no") {
                verifyCode = "no";
            }
        }
        if (verifyCode != "no") {
            console.log("1.1 | Wrong Faucet Code: " + req.body.code);
            res.render('error', {
                error: 'Wrong Faucet Code'
            });
        } else {
            console.log("1.1 | Checked Faucet Code: " + req.body.code);
            checkWallet(req.body.name);
            res.render('code', {
                error: errorMessage,
                balance: errorMessage2,
                status: errorMessage3,
                donate: faucetConfig.faucetAccountDonation,
            })
        }
        done();
    });

    app.use(function(req, res, next) {
        res.send('404 Not Found');
    });


    app.listen(faucetConfig.httpPort, function() {
        console.log('http server running on port ' + faucetConfig.httpPort);
    });

}

function done() {
    errorCode = '';
    errorMessage = '';
    errorMessage2 = '';
    errorMessage3 = '';
    balances = '';
}

function getAccountBalance(account) {
    var Url = faucetConfig.faucetWallet + `/burst?requestType=getAccount&account=${account}`;
    var amount;
    request({
            url: Url,
            method: "GET",
            json: true
        },
        function(error, response, body) {
            amount = satoshiToDecimal(body.balanceNQT);
            amount = amount.toFixed(2);
            errorMessage2 = amount + " Burst";
        }
    );
}

function checkWallet(account) {
    var rs = account;
    //Numeric 64 Bit
    if (!/^[a-zA-Z0-9]+$/.test(account) || account.length < 14 || account.length > 21) {
        // Validation failed
        console.log("1.3 | Wrong Account Format");
        errorMessage = 'Input ' + account + ' has wrong format or already positive balance'
    } else {
        checkAccount(account);
    }
}

function checkAccount(account) {
    var Url = faucetConfig.faucetWallet + `/burst?requestType=getAccount&account=${account}`
    request({
            url: Url,
            method: "GET",
            json: true
        },
        function(error, response, body) {
            if (body.errorCode == 5) {
                console.log("2 | Account is checked and ready for transfer");
                checkAccountBalance(account);
            } else {
                console.log("2 | Rejected: Account is already known and has confirmed balance");
            }

        }
    );
}

function checkAccountBalance(account) {
    var faucetAccount = faucetConfig.faucetAccount;
    var Url = faucetConfig.faucetWallet + `/burst?requestType=getAccount&account=${faucetAccount}`
    request({
            url: Url,
            method: "GET",
            json: true
        },
        function(error, response, body) {
            var balance = satoshiToDecimal(body.balanceNQT);
            console.log("3 | Faucet Account " + faucetConfig.faucetAccount + " | Balance: " + balance);
            //minimum balance for one payout
            if (balance >= 0.2) {
                console.log("4 | Status: adequate balance");
                sendPayment(account);
            } else {
                console.log("3 | Rejected: insufficient balance");
                errorMessage = 'Faucet has insufficient balance';
            }

        }
    );
}

function sendPayment(reci) {
    var key = faucetConfig.passphrase;
    var amount = faucetConfig.claimRewardNQT;
    var fee = faucetConfig.claimRewardNQT;
    fee = decimalToSatoshi(faucetConfig.claimFeeNQT);
    amount = decimalToSatoshi(faucetConfig.claimRewardNQT);

    var Url = faucetConfig.faucetWallet + `/burst?requestType=sendMoney&secretPhrase=${key}&recipient=${reci}&amountNQT=${amount}&feeNQT=${fee}&deadline=1440`
    request({
            url: Url,
            method: "POST",
            json: true
        },
        function(error, response, body) {
            console.log(body)
            if (!error) {
                console.log("5 | " + amount + " Burst transferred to " + reci);
                console.log("|-------------- Claim Successful --------------|");
                errorMessage3 = 'claim successful'
            }

        }
    );
}

function satoshiToDecimal(sat) {
    return parseFloat(sat) / 100000000.0;
}

function decimalToSatoshi(amount) {
    if (typeof amount === 'undefined' || isNaN(amount)) {
        return 0;
    }
    return parseInt(parseFloat(amount) * 100000000);
}

function strCompare(a, b) {
    if (a.toString() < b.toString()) return -1;
    if (a.toString() > b.toString()) return 1;
    return "no";
}
