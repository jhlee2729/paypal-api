const config = require('../config');
const env = require('./env').env;
const pool = require('./connection-pool').createPool(config[env].database);
const worker = require('./paypal-api');

const getPaypalSync = () => {
    return new Promise((resolve,reject) => {

        pool.getConnection((err,connection) => {

            if (err) throw err;
            connection.query(`SELECT * FROM app_paypal_sync WHERE is_run=1`,(err,rows) => {
                connection.release();
                pool.end();
                resolve(rows);
            });
        });

    })
}

const loopWorker = (store) => {
    return new Promise((resolve,reject)=>{

        let count = store.length;
        let check = 0;

        const goway = () => {

            if ( check != count ) {

                worker(store[check++],goway,check==count);
            }
        }
        goway();
    });
}

const init = async() => {

    try {
        const store = await getPaypalSync();
        loopWorker(store);
    } catch(e) {
        console.log(e)
    }
}

init();