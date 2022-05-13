const bitsyntax = require('ut-bitsyntax');
const assign = require('lodash.assign');
const invert = require('lodash.invert');
const isEmpty = require('lodash.isempty');
// var isObject = require('lodash.isobject');
const iconv = require('iconv-lite');
const messages = require('./messages');

const tlvTagsByName = {
    dest_addr_subunit: '0005',
    dest_network_type: '0006',
    dest_bearer_type: '0007',
    dest_telematics_id: '0008',
    source_addr_subunit: '000D',
    source_network_type: '000E',
    source_bearer_type: '000F',
    source_telematics_id: '0010',
    qos_time_to_live: '0017',
    payload_type: '0019',
    additional_status_info_text: '001D',
    receipted_message_id: '001E',
    ms_msg_wait_facilities: '0030',
    privacy_indicator: '0201',
    source_subaddress: '0202',
    dest_subaddress: '0203',
    user_message_reference: '0204',
    user_response_code: '0205',
    source_port: '020A',
    dest_port: '020B',
    sar_msg_ref_num: '020C',
    language_indicator: '020D',
    sar_total_segments: '020E',
    sar_segment_seqnum: '020F',
    sc_interface_version: '0210',
    callback_num_pres_ind: '0302',
    callback_num_atag: '0303',
    number_of_messages: '0304',
    callback_num: '0381',
    dpf_result: '0420',
    set_dpf: '0421',
    ms_availability_status: '0422',
    network_error_code: '0423',
    message_payload: '0424',
    delivery_failure_reason: '0425',
    more_messages_to_send: '0426',
    message_state: '0427',
    congestion_state: '0428',
    ussd_service_op: '0501',
    broadcast_channel_indicator: '0600',
    broadcast_content_type: '0601',
    broadcast_content_type_info: '0602',
    broadcast_message_class: '0603',
    broadcast_rep_num: '0604',
    broadcast_frequency_interval: '0605',
    broadcast_area_identifier: '0606',
    broadcast_error_status: '0607',
    broadcast_area_success: '0608',
    broadcast_end_time: '0609',
    broadcast_service_group: '060A',
    billing_identification: '060B',
    source_network_id: '060D',
    dest_network_id: '060E',
    source_node_id: '060F',
    dest_node_id: '0610',
    dest_addr_np_resolution: '0611',
    dest_addr_np_information: '0612',
    dest_addr_np_country: '0613',
    display_time: '1201',
    sms_signal: '1203',
    ms_validity: '1204',
    alert_on_message_delivery: '130C',
    its_reply_type: '1380',
    its_session_info: '1383',
    original_network_name: '1412',
    original_network_prefix: '140B',
    original_country: '1422',
    original_country_code: '1423',
    original_country_prefix: '1424',
    ported_network_name: '1413',
    ported_country_prefix: '1442',
    ported_network_prefix: '143E',
    ported_network_country_name: '143F',
    is_number_ported: '1421',
    roaming_network_name: '1414',
    roaming_network_prefix: '1419',
    roaming_country_name: '1415',
    roaming_country_code: '1417',
    roaming_country_prefix: '1420',
    mccmnc: '1416',
    price_per_message: '1418',
    serving_hlr: '1409',
    is_number_correct: '1425'
};
const tlvBuilders = {
    user_message_reference: {
        fix: function(v) { return parseInt(v, 10); },
        builder: bitsyntax.parse('t:2/binary, l:16/integer, v:16/integer'),
        tlv: {t: Buffer.from('0204', 'hex'), l: 2, v: 0}
    }
};
function tvlBuild(k, v) {
    const tlv = tlvBuilders[k];
    const o = tlv.tlv.v;
    tlv.tlv.v = v;
    if (tlv.fix) {
        tlv.tlv.v = tlv.fix(tlv.tlv.v);
    }
    const r = bitsyntax.build(tlv.builder, tlv.tlv);
    tlv.tlv.v = o;
    return r;
}

const tlvTagsById = invert(tlvTagsByName);

const encodingsByName = {
    default: 3,
    'ISO-8859-1': 3, // Latin 1
    'ISO-8859-5': 6, // Cyrillic
    'ISO-8859-8': 7, // Latin/Hebrew
    utf16le: 8, // ISO/IEC-10646
    UCS2: 8 // Alias of 'utf16le'
};

const encodingsById = invert(encodingsByName);
/**
 * SMPP commands parser
 *
 * @module SmppParser
 * @version 1.0
 */
function SmppParser(config, val, log) {
    this.logFactory = log;
    this.log = {};
    this.val = val;
    this.messageFormats = {};
    this.patterns = {};
    this.opCodes = {};
    this.headerPattern = bitsyntax.parse('commandId:32/integer, commandStatus:32/integer, sequenceNumber:32/integer, body/binary');
    this.tlvPattern = bitsyntax.parse('t:16/integer, l:16/integer, v:l/binary, next/binary');
    this.init(config);
}

SmppParser.prototype.init = function(config) {
    this.logFactory && (this.log = this.logFactory.createLog(config.logLevel, {name: config.id, context: 'SMPP codec'}));
    this.messageFormats = assign({}, messages, config.messageFormat);
    Object.keys(this.messageFormats).map(function(opcode) {
        if (this.messageFormats[opcode] && this.messageFormats[opcode].commandId) {
            if (this.messageFormats[opcode].pattern) {
                this.patterns[opcode] = bitsyntax.parse(this.messageFormats[opcode].pattern.join(', '));
            }
            this.opCodes[this.messageFormats[opcode].commandId] = opcode;
        }
    }, this);
};

/**
 * Decoding Buffer
 * @param {Buffer} buff - buffer for decoding.
 * @param {object} $meta - metadata
 * @returns {JSON}  json object with extracted values from buffer with property names from message pattern
 *  and system field $$:{'trace', 'mtid', 'opcode'}
 */
SmppParser.prototype.decode = function(buff, $meta, context, log) {
    if (log && log.trace) {
        // todo mask
        log.trace({$meta: {mtid: 'frame', method: 'smpp.decode'}, message: buff, log: context && context.session && context.session.log});
    }
    const headObj = bitsyntax.match(this.headerPattern, buff);
    if (!headObj) {
        throw new Error('Unable to match header to header pattern!');
    }

    headObj.commandId = ('00000000' + headObj.commandId.toString(16).toUpperCase()).slice(-8);
    const opcode = this.opCodes[headObj.commandId];
    const messageFormat = this.messageFormats[opcode];
    const pattern = this.patterns[opcode];
    let body = {};
    if (!opcode) {
        throw new Error('Not implemented opcode:' + headObj.commandId);
    }

    if (pattern) {
        if (headObj.body) {
            body = bitsyntax.match(pattern, headObj.body);
        }
        if (body.tlvs) {
            if (body.tlvs.length) {
                const tlvs = {};
                let tlv = bitsyntax.match(this.tlvPattern, body.tlvs);
                if (!tlv) {
                    throw new Error('Unable to match TLV!');
                }
                do {
                    const hex = ('0000' + tlv.t.toString(16).toUpperCase()).slice(-4);
                    tlv.t = tlvTagsById[hex] || 'tlv_' + hex.toLowerCase();
                    tlvs[tlv.t] = tlv.v;
                    tlv = bitsyntax.match(this.tlvPattern, tlv.next);
                } while (tlv);
                body.tlvs = tlvs;
            } else {
                body.tlvs = {};
            }
        }
    }
    // TODO: revise dataCoding and shortMessage
    if (body.dataCoding) {
        // maybe throw an error if dataCoding byte represents an integer which is an undefined index in the encodingsById object
        body.dataCoding = encodingsById[body.dataCoding] || encodingsById[encodingsByName.default];
    }
    if (body.shortMessage) {
        body.shortMessage = iconv.decode(body.shortMessage, body.dataCoding || encodingsById[encodingsByName.default]);
    }
    $meta.trace = headObj.sequenceNumber;
    $meta.opcode = opcode.replace(/Resp$/, '');
    $meta.method = 'smpp.' + $meta.opcode;
    $meta.mtid = messageFormat.mtid;
    return body;
};

/**
 * Convert object to Buffer
 * @param {object} data - json object with fields:{$$:{opcode - required, trace - required},  rest are field names from message pattern}
 * @param {object} $meta - metadata
 * @param {object} context - the connection context
 * @returns {buffer}  encoded buffer
 */
SmppParser.prototype.encode = function(data, $meta, context, log) {
    // TODO: add validation
    // TODO: revise dataCoding and shortMessage
    data.smLength = 0;
    if (data.dataCoding) {
        data.dataCoding = encodingsByName[data.dataCoding] || encodingsByName.default;
    }

    if (data.shortMessage) {
        data.shortMessage = iconv.encode(data.shortMessage, encodingsById[data.dataCoding || encodingsByName.default]);
        data.smLength = data.shortMessage.length;
    }
    const opcode = $meta.mtid === 'response' ? ($meta.opcode + 'Resp') : $meta.opcode;
    if (!this.messageFormats[opcode]) {
        throw new Error('Not implemented opcode:' + opcode + '!');
    }

    if ($meta.trace === null || $meta.trace === undefined) {
        context.trace += 1;
        if (context.trace > 999999999) {
            context.trace = 1;
        }
        $meta.trace = context.trace;
    }

    let body = Buffer.alloc(0);
    if (this.patterns[opcode]) {
        if (!data.tlvs || isEmpty(data.tlvs)) {
            data.tlvs = Buffer.alloc(0); // pass empty buffer
        } else {
            if (!data.tlvs || typeof data.tlvs !== 'object') {
                throw new Error('data.tvls must be an object of tagName:value pairs');
            }
            let tlvs = '';
            Object.keys(data.tlvs).map(function(tlv) {
                if (!tlvTagsByName[tlv]) {
                    throw new Error('Unknown TLV tag name: ' + tlv + '!');
                }
                tlvs += tvlBuild(tlv, data.tlvs[tlv]).toString('hex');
            }, this);
            data.tlvs = Buffer.from(tlvs, 'hex');
        }
        body = bitsyntax.build(this.patterns[opcode], data);
        if (!body) {
            throw new Error('Unable to build body for opcode:' + opcode + '!');
        }
    }
    const commandId = this.messageFormats[opcode].commandId;
    const buffer = bitsyntax.build(this.headerPattern, {commandId: parseInt(commandId, 16), commandStatus: 0, sequenceNumber: $meta.trace, body: body});
    if (log && log.trace) {
        log.trace({$meta: {mtid: 'frame', method: 'smpp.encode'}, message: buffer, log: context && context.session && context.session.log});
    }
    return buffer;
};

module.exports = SmppParser;
