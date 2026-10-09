/* Pure order validation shared by the HTML export and its tests. */
(function (scope) {
    'use strict';
    const PREFIX = 'TEMPE_COSTAR_ORDER_V1\n';
    function text(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
    function money(value) {
        const v = text(value).replace(/^(?:AUD\s*)?\$\s*/i, '').replace(/,/g, '');
        if (!/^\d+(?:\.\d{1,2})?$/.test(v)) throw new Error('Missing or invalid price: ' + value);
        const cents = Math.round(Number(v) * 100);
        if (!Number.isSafeInteger(cents) || cents > 100000000) throw new Error('Price is outside the supported range.');
        return cents;
    }
    function classify(sku, description) {
        const sourceSku = text(sku).toUpperCase();
        const product = text(description).toUpperCase();
        const service = /\bALIGNMENT\b|\bSERVICES?\s*:/.test(product) || /^SERVICES?$/.test(sourceSku);
        if (!service) {
            if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(sourceSku) || /^(?:F|M|DET|WA|WAFR)$/.test(sourceSku))
                return { kind: 'unmapped', costarCode: '', sourceSku, product };
            const bundledTyres = /\bPACKAGE\b/.test(product) && /\bWITH TYRES?\b/.test(product);
            return { kind: bundledTyres ? 'package' : 'product', costarCode: sourceSku, sourceSku, product };
        }
        // An empty website SKU can leave a leading colon before SERVICES.
        // Ignore only that formatting; the alignment wording must still match exactly.
        let label = product.replace(/^[:\s]*(?:SERVICES?\s*:[\s:]*)?/, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
        if (/^(?:FRONT (?:WHEEL )?ALIGNMENT|(?:WHEEL )?ALIGNMENT FRONT(?: ONLY)?)$/.test(label))
            return { kind: 'service', costarCode: 'WA', sourceSku, product };
        if (/^(?:FRONT (?:&|AND) REAR (?:WHEEL )?ALIGNMENT|(?:WHEEL )?ALIGNMENT FRONT (?:&|AND) REAR)$/.test(label))
            return { kind: 'service', costarCode: 'WAFR', sourceSku, product };
        return { kind: 'unmapped', costarCode: '', sourceSku, product };
    }
    function pickup(raw) {
        const m = text(raw).match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{1,2})\s+([A-Za-z]{3})\s+(20\d{2})\s+(\d{1,2}):(\d{2})(?:\s*([ap]m))?$/i);
        if (!m) throw new Error('Pickup date/time needs checking: ' + raw);
        const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const month = months.indexOf(m[3].toLowerCase());
        const date = new Date(Date.UTC(Number(m[4]), month, Number(m[2])));
        let hour = Number(m[5]); const minute = Number(m[6]);
        if (m[7]) { if (hour < 1 || hour > 12) throw new Error('Invalid pickup hour.'); hour = hour % 12 + (/pm/i.test(m[7]) ? 12 : 0); }
        const weekdays = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
        if (month < 0 || date.getUTCMonth() !== month || date.getUTCDate() !== Number(m[2]) || hour > 23 || minute > 59 || weekdays[date.getUTCDay()].slice(0,3) !== m[1].toUpperCase())
            throw new Error('Invalid pickup date/time.');
        return { date: date.toISOString().slice(0,10), time: String(hour).padStart(2,'0') + ':' + m[6], day: weekdays[date.getUTCDay()] };
    }
    function makeOrder(data, now) {
        if (!data || !/^TTW\d+$/i.test(text(data.orderId))) throw new Error('Select a fully loaded order first.');
        const deliveryMethod = text(data.deliveryMethod).toUpperCase();
        const delivery = /^(WITHIN AUSTRALIA|FITTING PARTNER)$/.test(deliveryMethod);
        const lines = (data.products || []).map(item => {
            const mapped = classify(item.sourceSku || item.sku, item.product);
            if (mapped.kind === 'unmapped') throw new Error('Service/product needs a COSTAR mapping: ' + item.product);
            if (!/^\d+$/.test(String(item.qty)) || Number(item.qty) < 1 || Number(item.qty) > 100) throw new Error('Check the quantity for ' + item.product);
            const priceCents = money(item.unitPrice), lineCents = money(item.lineTotal);
            if (priceCents <= 0 || priceCents * Number(item.qty) !== lineCents) throw new Error('Price/quantity does not match the line total for ' + item.product);
            return { kind: mapped.kind, sourceSku: mapped.sourceSku, code: mapped.costarCode, description: mapped.product, quantity: Number(item.qty), unitCents: priceCents, totalCents: lineCents };
        });
        if (!lines.length || lines.length > 12) throw new Error('This first version supports 1–12 priced lines.');
        const totalCents = money(data.amountText);
        const itemTotal = lines.reduce((sum, item) => sum + item.totalCents, 0);
        const charge = (pattern, discount = false) => {
            const values = (data.totals || []).filter(row => pattern.test(text(row.label)));
            if (values.length > 1) throw new Error('Duplicate charge rows need checking.');
            if (!values.length) return 0;
            const amount = text(values[0].amount);
            return money(discount ? amount.replace(/^-\s*/, '') : amount);
        };
        const freightCents = charge(/^Delivery Charges$/i);
        const surchargeCents = charge(/^Card Surcharge(?:\s.*)?$/i);
        const discountCents = charge(/^Discount Code(?:\s.*)?$/i, true);
        if (discountCents) throw new Error('Nonzero discounts still need their COSTAR entry mapped.');
        if (!delivery && freightCents) throw new Error('Pickup orders with freight still need their COSTAR entry mapped.');
        if (itemTotal + freightCents + surchargeCents - discountCents !== totalCents)
            throw new Error('The item totals differ from the online total after freight, card surcharge and discount.');
        const customer = {};
        for (const key of ['name','streetAddress','suburb','postcode','phone','email']) customer[key] = text(data[key]);
        if (!customer.name || !customer.phone) throw new Error('Customer name and phone are required.');
        const rego = text(data.rego).toUpperCase();
        if (delivery) {
            const billing = data.billingAddress, address = data.deliveryAddress;
            if (!billing?.lines?.length || !address?.lines?.length) throw new Error('Both billing and delivery addresses are required for delivery entry.');
            const street = value => text(value).replace(/,\s*$/, '').toUpperCase();
            customer.streetAddress = street(billing.addressLine1 || billing.streetAddress);
            customer.address2 = street(billing.addressLine2);
            customer.suburb = text(billing.suburb).toUpperCase();
            customer.state = text(billing.state).toUpperCase();
            customer.postcode = text(billing.postcode);
            const shipping = {
                name: text(address.recipient).toUpperCase(), streetAddress: street(address.addressLine1 || address.streetAddress),
                address2: street(address.addressLine2), suburb: text(address.suburb).toUpperCase(), state: text(address.state).toUpperCase(), postcode: text(address.postcode),
                contact: text(address.contact).toUpperCase(), businessPhone: text(address.phone), mobilePhone: customer.phone,
                email: text(address.email) || customer.email, shipVia: text(data.shipVia).toUpperCase(),
                instructions: address.estimatedFittingDate ? 'EST FITTING: ' + text(address.estimatedFittingDate).toUpperCase() : ''
            };
            for (const [label, addressToCheck] of [['billing', customer], ['delivery', shipping]]) {
                if (!addressToCheck.streetAddress || !addressToCheck.suburb || !/^(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)$/.test(addressToCheck.state) || !/^\d{4}$/.test(addressToCheck.postcode))
                    throw new Error('Check the ' + label + ' street, suburb, state and postcode.');
            }
            if (!shipping.name) throw new Error('The delivery recipient is missing.');
            const requiresReview = lines.some(line => line.kind === 'package');
            return { schema: 2, type: 'delivery', createdUtc: new Date(now || Date.now()).toISOString(), orderId: text(data.orderId).toUpperCase(),
                customer, shipping, deliveryMethod, deliveringBranch: text(data.deliveringBranch), paymentMethod: text(data.paymentMethod),
                vehicle: text(data.vehicleInfo), rego, freightCents, surchargeCents, discountCents, requiresReview,
                comment: 'DFE' + (requiresReview ? ' - PACKAGE REVIEW' : ''), totalCents, lines };
        }
        if (lines.some(line => line.kind === 'package')) throw new Error('Package pickup orders still need their component entry mapped.');
        const slot = pickup(data.pickupPreview);
        // Any store's pickup can be sent (helper 2.3.0+ checks it against the selected COSTAR
        // branch). Other stores use schema 3, which helpers before 2.3.0 refuse instead of
        // entering into Branch 11; Tempe pickups stay schema 1.
        const store = text(data.store);
        const tempe = !store || /^TEMPE(?:\s+NSW)?$/i.test(store);
        return { schema: tempe ? 1 : 3, createdUtc: new Date(now || Date.now()).toISOString(), orderId: text(data.orderId).toUpperCase(), customer, store,
            vehicle: text(data.vehicleInfo), rego, pickupDate: slot.date, pickupTime: slot.time, freightCents, surchargeCents, discountCents,
            comment: (rego ? rego + ' - ' : '') + slot.day + ' - ONLINE ' + slot.time, totalCents, lines };
    }
    const api = { PREFIX, text, money, classify, pickup, makeOrder };
    scope.TempeCostar = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
