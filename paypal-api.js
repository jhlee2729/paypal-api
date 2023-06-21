const axios = require('axios');
const dateformat = require('dateformat');
const config = require('../config');
const env = require('./env.json').env;
const pool = require('./connection-pool').createPool(config[env].database);
const settingDate = config[env].setting_date;

const syncData = {
    paypal_id:'',
    account:'',
    access_token:''
}

const contents = {
    now:'',
    start_date: '',
    end_date: ''
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

const lastApiHistory = () => {

    return new Promise((resolve,reject) => {

        //2014-07-01T00:00:00-0700
        execute(`SELECT * FROM app_paypal_api_history\
            WHERE paypal_id = ${syncData.paypal_id}
            ORDER BY api_history_id DESC LIMIT 1`, (err,rows) => {

            if (err) throw err;

            if( rows.length >= 1) {
                contents.start_date = rows[0].start_date;
                resolve();
            } else {
                contents.start_date = settingDate.start_date;
                resolve();

            }
        })

    })

}

const dateCheck = () => {
    return new Promise((resolve,reject) => {

        // 기본 end_date = start_date + 2주
        contents.end_date = new Date(contents.start_date).setDate(new Date(contents.start_date).getDate()+14);

        contents.start_date = dateformat(contents.start_date, `yyyy-mm-dd'T'HH:MM:ss+0000`);
        contents.end_date = dateformat(contents.end_date, `yyyy-mm-dd'T'HH:MM:ss+0000`);
        contents.now = dateformat(new Date(), `yyyy-mm-dd'T'HH:MM:ss+0000`);
        console.log(`now:${contents.now}, start_date:${contents.start_date}, end:${contents.end_date}`, contents.now < contents.end_date);

        if (contents.now < contents.end_date) {
            contents.end_date = contents.now
        }
        resolve();
    })
}

const getTransaction = () => {

    return new Promise((resolve,reject) => {

        let start_date = contents.start_date;
        let end_date = contents.end_date;

        let page_size = 500; // limit
        let page = 1;

        const callAPI = () => {
            axios({
                method: 'GET',
                url: 'https://api-m.paypal.com/v1/reporting/transactions',
                headers: {
                    "Content-Type" : `application/json`,
                    "Authorization": `Bearer ${syncData.access_token}`,
                },
                params: {
                    start_date:start_date, 
                    end_date:end_date,
                    fields:'all',
                    page_size:page_size,
                    page:page
                }
          
            }).then((response) => {

                response.data.transaction_details.map(i => { 
                    console.log(i.transaction_info.transaction_id, i.transaction_info.transaction_updated_date )
                })

                console.log("response", response.data.start_date)
                console.log("response", response.data.end_date)

                // console.log("response.start_date", response.data.start_date);
                // console.log("response.end_date", response.data.end_date);
                // console.log("첫번쨰 inovice",  response.data.transaction_details[0])
                // console.log("2번째 데이터", insertData.transaction_info[page].transaction_info.transaction_id)

                let total_items = response.data.total_items;
                let total_pages = response.data.total_pages;

                console.log(`total_items: ${total_items},total_pages :${total_pages}, page:${page}, ${total_pages!==page}`);
                
                // response.data.transaction_details.map(i => {
                //     insertData.transaction_info = insertData.transaction_info.concat(i);

                //     // if(i.transaction_info.transaction_id == '7SX72684TW306463B') {
                //     //     console.log(i.transaction_info)
                //     // }

                //     // console.log(i.transaction_info.transaction_id);
                //     // console.log(i.transaction_info.invoice_id);
                //     // console.log(i.transaction_info.transaction_initiation_date);
                //     // console.log(i.transaction_info.transaction_updated_date);
                //     // console.log(i.transaction_info.transaction_amount.value);
                //     // console.log((i.transaction_info.hasOwnProperty('fee_amount') && i.transaction_info.fee_amount.value) || 0);
                //     // console.log(i.transaction_info.transaction_status);
                //     // console.log("======================")
                // })
                
                if ( (total_pages !== page) && total_items !==0 ) {
                    ++page;
                    callAPI();
                    
                } else {
                    // console.log("length", insertData.transaction_info.length)
                    resolve(true);
                }
               
            }).catch((err)=>{
                console.log("err", err);
            });
        }

        callAPI();
    })

}

const worker = async(sync,callback,bool) => {

    syncData.paypal_id = sync.paypal_id;
    syncData.account = sync.account;
    syncData.access_token = sync.access_token;

    await lastApiHistory();
    await dateCheck();
    await getTransaction();

    // const token = sync.map(i => i.access_token);
    // const paypalId = sync.map(i => i.paypal_id);
    // syncData = syncData.concat({"paypal_id":sync.paypal_id, "access_token":sync.access_token});
    // const token = sync.map(obj => Object.entries(obj));
    // console.log("token", token)
}

module.exports = worker;