const axios = require('axios');
const btoa = require('btoa');
const dateformat = require('dateformat');
const config = require('../config');
const env = require('./env.json').env;
const pool = require('./connection-pool').createPool(config[env].database);

// 1. is_run=1인 계정 정보가져오기
// 2. access token 발급
// 3. app_id 기준 업데이트

const authorization = [];

const execute = (sql,callback,data = {} )=>{

    pool.getConnection((err,connection) => {
        if (err) throw err;

        connection.query(sql,data,(err,rows) => {
            connection.release();
            if ( err ) {
                throw err;
            } else {
                callback(err, rows);
            }
        });
    });
}

const closing = () => {
    pool.end();
}

const getAccount = () => {
    return new Promise((resolve,reject) => {

        execute(`SELECT account, client_id, secret_key FROM app_paypal_sync WHERE is_run=1;`, (err,rows) => {

            if (err) throw err;

            rows.forEach( i => {
                const enCodeBase64 = 'Basic ' + btoa(`${i.client_id}:${i.secret_key}`);
                authorization.push(enCodeBase64);
            })

            resolve();
        })
    })
}

const callAPI = () => {
    return new Promise((resolve,reject) => {
        
        const requests = authorization.map(auth => {

            const headers = {
                'Content-Type' : 'application/x-www-form-urlencoded',
                'Authorization' : auth
            };

            return axios({
                method: 'POST',
                url: 'https://api-m.paypal.com/v1/oauth2/token',
                headers: headers,
                data : {
                    grant_type: 'client_credentials'
                }
            })
            
        })

        Promise.all(requests)
    
            .then(responses => {

                responses.forEach(response => {

                    console.log("response", response.data);

                    const now = new Date();
                    const second = now.getTime();
                    const access_token = response.data.access_token;
                    const expires_in = response.data.expires_in;
                    const expires_in_time = dateformat(second + (expires_in * 1000),'yyyy-mm-dd HH:MM:ss');
                    const app_id = response.data.app_id;

                    execute(`UPDATE app_paypal_sync
                            SET access_token="${access_token}",
                            expires_in=${expires_in},
                            expires_in_time="${expires_in_time}"
                            WHERE app_id ="${app_id}"
                            `,
                        (err, rows) => {
                            if(err) throw err;
                            closing();
                        })
                });

            })
        
        .catch(error => {
            console.error(error);
        });

    })
}

const worker = async() => {

    try {
        await getAccount();
        await callAPI();
    } catch(error){
        console.log(error)
    }

}

worker();