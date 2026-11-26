"use client";

import { useEffect, useState } from "react";
import "../globals.css";

function MethodLogo({ method }: { method: string }) {
  if (method === "Visa") return <i className="checkout-logo logo-visa" aria-hidden="true">VISA</i>;
  if (method === "Mastercard") return <i className="checkout-logo logo-mastercard" aria-hidden="true"><b /><b /></i>;
  if (method === "微信支付") return <i className="checkout-logo logo-wechat" aria-hidden="true"><b>✓</b></i>;
  return <i className="checkout-logo logo-alipay" aria-hidden="true">支</i>;
}

export default function SubscribePage() {
  const [locale, setLocale] = useState("zh-CN");
  useEffect(() => setLocale(new URLSearchParams(window.location.search).get("locale") || "zh-CN"), []);
  const english = locale === "en";
  const methods = english ? ["Visa", "Mastercard"] : ["微信支付", "支付宝"];
  return <main className="payment-page"><section className="payment-card"><a href="/" className="payment-back">← {english ? "Back to Between Stitches" : "返回织间"}</a><span className="membership-kicker">{english ? "TEST CHECKOUT" : "测试支付页"}</span><h1>{english ? "Choose a payment method" : "请选择支付方式"}</h1><div className="checkout-methods">{methods.map((method) => <button type="button" key={method} onClick={() => window.alert(english ? `Test: ${method} payment selected. A real checkout will open after the merchant account is connected.` : `测试：已选择${method}。商户账号接入后，这里将打开真实支付页面。`)}><MethodLogo method={method}/><span>{method}</span></button>)}</div><small>{english ? "This is a test checkout. No payment will be collected." : "这是测试支付页面，不会实际扣款。"}</small></section></main>;
}
