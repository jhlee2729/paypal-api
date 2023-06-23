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

const insertData = {
    transaction_info:[],
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

        execute(`SELECT * FROM app_paypal_api_history\
            WHERE paypal_id = ${syncData.paypal_id}
            ORDER BY api_history_id DESC LIMIT 1`, (err,rows) => {

            if (err) throw err;

            if( rows.length >= 1) {
                contents.start_date = new Date(rows[0].end_date).setHours(new Date(rows[0].end_date).getHours()-9);
                resolve();
            } else {
                //시간 맞춰주기 : 설정시간 - 9시간
                contents.start_date = new Date(settingDate.start_date).setHours(new Date(settingDate.start_date).getHours()-9);
                resolve();

            }
        })

    })

}

const dateCheck = () => {
    return new Promise((resolve,reject) => {

        // 기본 end_date = start_date + 2주
        contents.end_date = new Date(contents.start_date).setDate(new Date(contents.start_date).getDate()+14);
        // 현재시간에서 4시간 전까지 조회 : UTC - 9시간 반영 : -13 -> end_date : 현재에서 -4시간 전까지 부르겠다는 의미임
        contents.now = new Date().setHours(new Date().getHours()-13);

        contents.start_date = dateformat(contents.start_date, `yyyy-mm-dd'T'HH:MM:ss-0000`);
        contents.end_date = dateformat(contents.end_date, `yyyy-mm-dd'T'HH:MM:ss-0000`);
        contents.now = dateformat(contents.now, `yyyy-mm-dd'T'HH:MM:ss-0000`);

        console.log(`now:${contents.now}`)
        console.log(`start_date:${contents.start_date}, end:${contents.end_date}`, contents.now < contents.end_date);

        if (contents.now < contents.end_date) { //설정한 end 시간이 현재시간보다 더클경우
            contents.end_date = contents.now
        }

        resolve();
    })
}

const getTransaction = () => {

    return new Promise((resolve,reject) => {

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
                    start_date:contents.start_date, 
                    end_date:contents.end_date,
                    fields:'all',
                    page_size:page_size,
                    page:page
                }
          
            }).then((response) => {

                // response.data.transaction_details.map(i => { 
                //     console.log(i.transaction_info.transaction_id, i.transaction_info.transaction_updated_date )
                // })

                let res_start_date = response.data.start_date;
                let res_end_date = response.data.end_date;
                let total_items = response.data.total_items;
                let total_pages = response.data.total_pages;
                
                console.log(`호출 : ${contents.start_date}, ${contents.end_date}`)
                console.log(`응답: ${res_start_date}, ${res_end_date}`);
                console.log(`total_items: ${total_items},total_pages :${total_pages}, page:${page}, ${total_pages!==page}`);
                
                response.data.transaction_details.map(i => {
                    insertData.transaction_info = insertData.transaction_info.concat(i);
                })

                if ( (total_pages !== page) && total_items !==0 ) {
                    ++page;
                    callAPI();
                    
                } else {
                    // console.log("length", insertData.transaction_info.length)
                    resolve(true);
                }
               
            }).catch((err)=>{
                console.log("err", err.response.data);
                resolve(false);
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
    
    const tomodel_data = {
        paypal_id: syncData.paypal_id,
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

        // 실제 호출시간 맞추겠다
        // contents.start_date = new Date(contents.start_date).setHours(new Date(contents.start_date).getHours()-9); 
        // contents.end_date = new Date(contents.end_date).setHours(new Date(contents.end_date).getHours()-9); 

        execute(`INSERT INTO app_paypal_api_history (
                start_date,
                end_date,
                paypal_id,
                count
                ) VALUES (
                    "${dateformat(contents.start_date, 'yyyy-mm-dd HH:MM:ss')}",
                    "${dateformat(contents.end_date,'yyyy-mm-dd HH:MM:ss')}",
                    ${syncData.paypal_id},
                    ${insertData.transaction_info.length}
                )`,
                (err,rows)=>{
                    if ( err ) {
                        throw err;
                    } else {
                        resolve();
                    }
                }, {});
    })
}

const connectionClose = (callback,bool) => {
    return new Promise((resolve,reject) => {

        console.log(new Date() + ' 종료');
        console.log('=====================================================================');

        if ( bool ) {
            closing();
        }
        callback();
    });
}

const worker = async(sync,callback,bool) => {

    console.log('=====================================================================');
    console.log(new Date() + ' 시작');

    syncData.paypal_id = sync.paypal_id;
    syncData.account = sync.account;
    syncData.access_token = sync.access_token;

    insertData.transaction_info = [];

    await lastApiHistory();
    await dateCheck();
    const success = await getTransaction();

    if ( !success ) {
        await connectionClose(callback,bool);
        return;
    }

    insertData.transaction_info.length !=0 && await insertTransaction();

    await timeSave();
    await connectionClose(callback,bool);

}

module.exports = worker;