const axios = require('axios');
const btoa = require('btoa');
const dateformat = require('dateformat');
const config = require('../config');
const env = require('./env.json').env;
const pool = require('./connection-pool').createPool(config[env].database);

require('dotenv').config();

const insertData = {
    transaction_info:[],
}

const contents = {
    start_date: '',
    end_date: '',
}

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

const renewalAccessToken = () => {
    return new Promise((resolve,reject) => {
        
        let authorization = 'Basic ' + btoa(`${process.env.CLIENT_ID}:${process.env.CLIENT_SECRET}`);
        let headers = {
            'Content-Type' : 'application/x-www-form-urlencoded',
            'Authorization' : authorization
        };
    
        axios({
            method: 'POST',
            url: 'https://api-m.paypal.com/v1/oauth2/token',
            headers: headers,
            data : {
                grant_type: 'client_credentials'
            }
      
        }).then((response) => {
    
            // console.log("response", response.data);
            const now = new Date();
            const second = now.getTime();
            const access_token = response.data.access_token;
            const expires_in = response.data.expires_in;
            const expires_in_time = dateformat(second + (expires_in * 1000),'yyyy-mm-dd HH:MM:ss');
           
            execute(`UPDATE app_paypal_sync 
                SET access_token="${access_token}",
                expires_in=${expires_in},
                expires_in_time="${expires_in_time}"`,
                (err,rows) => {
                    if (err) throw err;
                    resolve();
            });
    
        }).catch((err) => {
            closing();
            console.log(err.message);
        });
    })

}

const getAccessToken = () => {
    return new Promise((resolve,reject)=>{

        execute(`SELECT access_token FROM app_paypal_sync`,
        (err,rows) => {
            if (err) throw err;
            const access_token = rows[0].access_token;
            resolve(access_token);
        });
    });
}

const getDate = () => {
    return new Promise((resolve,reject) => {

        execute(`SELECT start_date, end_date FROM app_paypal_api_history
        ORDER BY api_history_id DESC LIMIT 1`, 
        (err,rows) => {

            if (err) {
                throw err;
            } else {

                if (rows.length >=1 ) {

                    // contents.start_date = new Date(rows[0].end_date).setHours(new Date(rows[0].end_date).getHours()-9);
                    contents.start_date = rows[0].end_date;
                    contents.end_date = new Date(contents.start_date).setDate(new Date(contents.start_date).getDate()+14);
                    
                    contents.start_date = dateformat(contents.start_date, `yyyy-mm-dd'T'HH:MM:ss-0000`);
                    contents.end_date = dateformat(contents.end_date, `yyyy-mm-dd'T'HH:MM:ss-0000`);
                    console.log(`${contents.start_date}, ${contents.end_date}`)
                    resolve();
                }
            }

        })
    })
}

const getTransaction = (token) => {

    return new Promise((resolve,reject) => {
        // contents.start_date = '2022-12-31T15:00:00-0000';
        // contents.end_date = '2023-01-01T15:00:00-0000';
        
        let page_size = 500; // limit
        let page = 1;

        const callAPI = () => {
            axios({
                method: 'GET',
                url: 'https://api-m.paypal.com/v1/reporting/transactions',
                headers: {
                    "Content-Type" : `application/json`,
                    "Authorization": `Bearer ${token}`,
                },
                params: {
                    start_date : contents.start_date,
                    end_date : contents.end_date,
                    fields:'all',
                    page_size:page_size,
                    page:page
                }
          
            }).then((response) => {
                // console.log("response", response.data)

                // console.log("response.start_date", response.data.start_date);
                // console.log("response.end_date", response.data.end_date);
                // console.log("첫번쨰 inovice",  response.data.transaction_details[0])
                // console.log("2번째 데이터", insertData.transaction_info[page].transaction_info.transaction_id)

                let total_items = response.data.total_items;
                let total_pages = response.data.total_pages;
                
                response.data.transaction_details.map(i => {
                    insertData.transaction_info = insertData.transaction_info.concat(i);

                    // if(i.transaction_info.transaction_id == '7SX72684TW306463B') {
                    //     console.log(i.transaction_info)
                    // }

                    // console.log(i.transaction_info.transaction_id);
                    // console.log(i.transaction_info.invoice_id);
                    // console.log(i.transaction_info.transaction_initiation_date);
                    // console.log(i.transaction_info.transaction_updated_date);
                    // console.log(i.transaction_info.transaction_amount.value);
                    // console.log((i.transaction_info.hasOwnProperty('fee_amount') && i.transaction_info.fee_amount.value) || 0);
                    // console.log(i.transaction_info.transaction_status);
                    // console.log("======================")
                })
                
                console.log(`total_items: ${total_items},total_pages :${total_pages}, page:${page}, ${total_pages!==page}`);

                if ( total_pages !== page ) {
                    ++page;
                    callAPI();
                    
                } else {
                    console.log("length", insertData.transaction_info.length)
                    resolve(true);
                }
               
            }).catch((err)=>{
                console.log("err", err);
            });
        }

        callAPI();

    })

}

const insertTransaction = () => {
    return new Promise((resolve,reject) => {

        let loop = 0;
        const callAPI = () => {
            insertData.transaction_info.length == loop ? 
            resolve() :
            databaseInsert(insertData.transaction_info[loop++], callAPI);
        }
        databaseInsert(insertData.transaction_info[loop++], callAPI)

    })
}

const databaseInsert = (data, callback) => {

    let initiation_date = dateformat(new Date(data.transaction_info.transaction_initiation_date),'yyyy-mm-dd HH:MM:ss');
    let updated_date = dateformat(new Date(data.transaction_info.transaction_updated_date),'yyyy-mm-dd HH:MM:ss');
    console.log("data", data)

    const tomodel_data = {
        transaction_id: data.transaction_info.transaction_id,
        transaction_event_code: data.transaction_info.transaction_event_code,
        order_number: data.transaction_info.invoice_id, 
        initiation_date,
        updated_date, 
        transaction_amount: Number(data.transaction_info.transaction_amount.value),
        fee_amount:Number((data.transaction_info.hasOwnProperty('fee_amount') && data.transaction_info.fee_amount.value)) || 0,
        transaction_status: data.transaction_info.transaction_status,
        transaction_note:  data.transaction_info.transaction_note,
        payer_email: data.payer_info.hasOwnProperty('email_address') && data.payer_info.email_address,
        payer_name: data.payer_info.hasOwnProperty('payer_name') && data.payer_info.payer_name.alternate_full_name
    }

    execute(`INSERT INTO app_paypal_transaction SET ?`,
    (err,rows)=>{
        if ( err ) {
           throw err;
        } else {
            callback();
        }
    }, tomodel_data);

}

const timeSave = () => {
    return new Promise((resolve,reject) => {

        contents.end_date = new Date(contents.end_date).setHours(new Date(contents.end_date).getHours()-9);

        execute(`INSERT INTO app_paypal_api_history (
                start_date,
                end_date,
                count
                ) VALUES (
                    "${dateformat(contents.start_date, 'yyyy-mm-dd HH:MM:ss')}",
                    "${dateformat(contents.end_date,'yyyy-mm-dd HH:MM:ss')}",
                    ${insertData.transaction_info.length}
                )`,
                (err,rows)=>{
                    if ( err ) {
                        throw err;
                    } else {
                        closing();
                        resolve();
                    }
                }, {});
    })
}

const worker = async () => { 
    try {
        await renewalAccessToken();
        let token = await getAccessToken();
        await getDate();
        await getTransaction(token);
        await insertTransaction();
        await timeSave();

    } catch(e) {
        console.log(e);
    }
}

worker();