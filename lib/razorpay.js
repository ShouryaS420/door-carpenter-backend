// lib/razorpay.js
import Razorpay from "razorpay";


const RAZORPAY_KEY_ID = "rzp_test_eMzUqt9wdPSwA3"
const RAZORPAY_KEY_SECRET = "IMhZ8dC5IAeGGKVGgIShqBrE"

export const razorpay = new Razorpay({
    key_id:     RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});
