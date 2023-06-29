const config = require('../config');
const env = require('./env.json').env;
const dateformat = require('dateformat');
const pool = require('./connection-pool').createPool(config[env].database);
const settingDate = config[env].setting_date;
const axios = require('axios');
const error_hook = require('./slackhook');

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
    response_data:[],
}

const execute = (sql,callback,data = {} )=>{

    pool.getConnection((err,connection) => {
        if (err) throw err;

        connection.query(sql,data,(err,rows) => {
            connection.release();
            if (err) {
                error_hook(syncData.account, err, (err, res)=> {
                    console.log("execute", err);
                    throw err;
                })
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

        execute(`SELECT * FROM app_paypal_api_history
            WHERE paypal_id = ${syncData.paypal_id}
            ORDER BY api_history_id DESC LIMIT 1`, (err,rows) => {

            if (err) {
                error_hook(syncData.account, err, (err, res)=> {
                    console.log("lastApiHistory", err);
                    throw err;
                }) 
            } else {
                //시간 맞춰주기 : 설정시간-9시간
                if( rows.length >= 1) {
                    contents.start_date = new Date(rows[0].end_date).setHours(new Date(rows[0].end_date).getHours()-9);
                    resolve();
                } else {
                    contents.start_date = new Date(settingDate.start_date).setHours(new Date(settingDate.start_date).getHours()-9);
                    resolve();
                }
            }
        })
    })
}

const dateCheck = () => {
    return new Promise((resolve,reject) => {

        // 기본 end_date = start_date + 2주
        contents.end_date = new Date(contents.start_date).setDate(new Date(contents.start_date).getDate()+14);
        // 현재시간에서 4시간 전까지 조회 : -9시간 반영 : -13 -> end_date : 현재에서 -4시간 전까지 호출하겠다는 의미
        contents.now = new Date().setHours(new Date().getHours()-13);
        contents.start_date = dateformat(contents.start_date, `yyyy-mm-dd'T'HH:MM:ss-0000`);
        contents.end_date = dateformat(contents.end_date, `yyyy-mm-dd'T'HH:MM:ss-0000`);
        contents.now = dateformat(contents.now, `yyyy-mm-dd'T'HH:MM:ss-0000`);

        if (contents.now < contents.end_date) { //설정한 end 시간이 현재 시간보다 더클경우
            contents.end_date = contents.now
        }

        resolve();
    })
}

const getTransaction = () => {

    return new Promise((resolve,reject) => {

        let page_size = 500;
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

                let total_items = response.data.total_items;
                let total_pages = response.data.total_pages;
                
                response.data.transaction_details.map(i => {
                    insertData.response_data = insertData.response_data.concat(i);
                })

                if ( (total_pages !== page) && total_items !==0 ) {
                    ++page;
                    callAPI();
                    
                } else {
                    resolve(true);
                }
               
            }).catch((err) => {
                error_hook(syncData.account, err, (err, res)=> {
                    console.log("getTransaction", err);
                    resolve(false);
                }) 
            });
        }

        callAPI();
    })

}

const insertTransaction = () => {
    return new Promise((resolve,reject) => {

        let loop = 0;
        const callAPI = () => {
            insertData.response_data.length == loop ? 
            resolve() :
            databaseInsert(insertData.response_data[loop++], callAPI);
        }
        databaseInsert(insertData.response_data[loop++], callAPI)

    })
}

const databaseInsert = (data, callback) => {

    let transaction_initiation_date = dateformat(new Date(data.transaction_info.transaction_initiation_date),'yyyy-mm-dd HH:MM:ss');
    let transaction_updated_date = dateformat(new Date(data.transaction_info.transaction_updated_date),'yyyy-mm-dd HH:MM:ss');

    const tomodel_data = {

        //transaction_info
        paypal_id: syncData.paypal_id,
        order_number: data.transaction_info.invoice_id, 
        paypal_account_id: data.transaction_info.paypal_account_id,
        transaction_id: data.transaction_info.transaction_id,
        paypal_reference_id: data.transaction_info.paypal_reference_id,
        paypal_reference_id_type: data.transaction_info.paypal_reference_id_type,
        transaction_event_code: data.transaction_info.transaction_event_code,
        transaction_status: data.transaction_info.transaction_status,
        transaction_subject: data.transaction_info.transaction_subject,
        transaction_note: data.transaction_info.transaction_note,
        bank_reference_id : data.transaction_info.bank_reference_id,
        protection_eligibility : data.transaction_info.protection_eligibility,
        instrument_type : data.transaction_info.instrument_type,
        transaction_initiation_date,
        transaction_updated_date,
        transaction_amount: Number(data.transaction_info.transaction_amount.value),
        fee_amount: Number((data.transaction_info.hasOwnProperty('fee_amount') && data.transaction_info.fee_amount.value)) || 0,
        ending_balance: Number(data.transaction_info.tr),
        ending_balance: Number((data.transaction_info.hasOwnProperty('ending_balance') && data.transaction_info.ending_balance.value)) || 0,
        available_balance: Number((data.transaction_info.hasOwnProperty('available_balance') && data.transaction_info.available_balance.value)) || 0,

        //payer_info
        address_status: data.payer_info.address_status,
        payer_status: data.payer_info.payer_status,
        email_address: data.payer_info.hasOwnProperty('email_address') && data.payer_info.email_address || '',

        given_name: data.payer_info.payer_name.hasOwnProperty('given_name') && data.payer_info.payer_name.given_name || '',
        surname: data.payer_info.payer_name.hasOwnProperty('surname') && data.payer_info.payer_name.surname || '',
        middle_name: data.payer_info.payer_name.hasOwnProperty('middle_name') && data.payer_info.payer_name.middle_name || '',
        alternate_full_name: data.payer_info.hasOwnProperty('payer_name') && data.payer_info.payer_name.alternate_full_name || '',
        country_code : data.payer_info.country_code
    }

    execute(`INSERT INTO app_paypal_transaction SET ?`,
    (err,rows) => {
        if (err) {
            error_hook(syncData.account, err, (err, res)=> {
                console.log("databaseInsert", err);
                throw err;
            }) 
        } else {
            callback();
        }
    }, tomodel_data);

}

const timeSave = () => {
    return new Promise((resolve,reject) => {

        execute(`INSERT INTO app_paypal_api_history (
                start_date,
                end_date,
                paypal_id,
                count
                ) VALUES (
                    "${dateformat(contents.start_date, 'yyyy-mm-dd HH:MM:ss')}",
                    "${dateformat(contents.end_date,'yyyy-mm-dd HH:MM:ss')}",
                    ${syncData.paypal_id},
                    ${insertData.response_data.length}
                )`,
                (err,rows)=>{
                    if ( err ) {
                        error_hook(syncData.account, err, (err, res)=> {
                            console.log("databaseInsert", err);
                            throw err;
                        }) 
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

    insertData.response_data = [];

    await lastApiHistory();
    await dateCheck();
    const success = await getTransaction();

    if ( !success ) {
        await connectionClose(callback,bool);
        return;
    }

    insertData.response_data.length !=0 && await insertTransaction();

    await timeSave();
    await connectionClose(callback,bool);

}

module.exports = worker;