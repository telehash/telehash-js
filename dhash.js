var crypto = require('crypto');

/**
 * Hash objects represent the sha1 of string content,
 * with methods useful to DHT calculations.
 * @constructor
 */
function Hash(value, hex) {
    if(value == undefined) value = "";
    if(hex) this.digest = hex2buf(hex);
    // if failed still, just treat as a string
    if (!this.digest) {
        var hashAlgorithm = crypto.createHash("SHA1");
        hashAlgorithm.update(value);
        this.digest = new Buffer(hashAlgorithm.digest("base64"), "base64");
    }
    this.nibbles = [];
    for (var i = 0; i < this.digest.length; i++) {
        this.nibbles[this.nibbles.length] = this.digest[i] >> 4;
        this.nibbles[this.nibbles.length] = this.digest[i] & 0xf;
    }
}

function hex2buf(str)
{
    var buf = new Buffer(20);
    for (var i = 0; i < str.length / 2; i ++) {
        var byte = parseInt(str.substr(i * 2, 2), 16);
        if (isNaN(byte)) return null;
        buf[i] = byte;
    }
    return buf;
}

/**
 * Format a byte as a two digit hex string.
 */
function byte2hex(d) {
    return d < 16 ? "0" + d.toString(16) : d.toString(16);
}


exports.Hash = Hash

/**
 * Get the string hash as geometrically "far" as possible from this one.
 * That would be the logical inverse, every bit flipped.
 */
Hash.prototype.far = function() {
    var result = [];
    for (var i = 0; i < this.digest.length; i++) {
        result[i] = byte2hex(this.digest[i] ^ 0xff);
    }
    return result.join("");
}

/**
 * Logical bitwise 'or' this hash with another.
 */
Hash.prototype.or = function(h) {
    if (typeof h == 'string') { h = new Hash(h); }

    var result = new Hash();
    result.digest = new Buffer(this.digest.length);
    for (var i = 0; i < this.digest.length; i++) {
        result.digest[i] = this.digest[i] ^ h.digest[i];
    }
    return result;
}

/**
 * Comparator for hash objects.
 */
Hash.prototype.cmp = function(h) {
    for (var i = 0; i < this.digest.length; i++) {
        var d = this.digest[i] - h.digest[i];
        if (d != 0) {
            return d;
        }
    }
    return 0;
}

/**
 * XOR distance between two sha1 hex hashes, 159 is furthest bit, 0 is closest bit, -1 is same hash
 */
Hash.prototype.distanceTo = function(h) {
    var sbtab = [-1,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3];
    var ret = 156;
    for (var i = 0; i < this.nibbles.length; i++) {
        var diff = this.nibbles[i] ^ h.nibbles[i];
        if (diff) {
            return ret + sbtab[diff];
        }
        ret -= 4;
    }
    return -1; // samehash ?!
}

/**
 * Represent the hash as a hexadecimal string.
 */
Hash.prototype.toString = function() {
    var result = [];
    for (var i = this.digest.length - 1; i >= 0; i--) {
        result[i] = byte2hex(this.digest[i]);
    }
    return result.join("");
}

/**
 * Test if two hashes are equal.
 */
Hash.prototype.equals = function(h) {
    return this.toString() == h.toString();
}