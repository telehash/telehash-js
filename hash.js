var crypto = require('crypto');

/**
 * Hash objects represent the sha1 of string content,
 * with methods useful to DHT calculations.
 * @constructor
 */
function Hash(value) {
    if(value == undefined) value = "";
    if(value.length == 40) this.digest = hex2buf(value);
    // if failed still, just treat as a string
    if (!this.digest) {
        var hashAlgorithm = crypto.createHash("SHA1");
        hashAlgorithm.update(value);
        this.digest = new Buffer(hashAlgorithm.digest("base64"), "base64");
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
 * Get the hash as geometrically "far" as possible from this one.
 * That would be the logical inverse, every bit flipped.
 */
Hash.prototype.far = function() {
    var result = new Hash();
    result.digest = new Buffer(this.digest.length);
    for (var i = 0; i < this.digest.length; i++) {
        result.digest[i] = this.digest[i] ^= 0xff;
    }
    return result;
}

/**
 * Logical bitwise 'or' this hash with another.
 */
Hash.prototype.or = function(h) {
    if (isString(h)) { h = new Hash(h); }

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
    if (isString(h)) { h = new Hash(h); }

    for (var i = 0; i < this.digest.length; i++) {
        var d = this.digest[i] - h.digest[i];
        if (d != 0) {
            return d;
        }
    }
    return 0;
}

Hash.prototype.nibbles = function() {
    var result = [];
    for (var i = 0; i < this.digest.length; i++) {
        result[result.length] = this.digest[i] >> 4;
        result[result.length] = this.digest[i] & 0xf;
    }
    return result;
}

/**
 * XOR distance between two sha1 hex hashes, 159 is furthest bit, 0 is closest bit, -1 is same hash
 */
Hash.prototype.distanceTo = function(h) {
    if (isString(h)) { h = new Hash(h); }

    var nibbles = this.nibbles();
    var hNibbles = h.nibbles()

    var sbtab = [-1,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3];
    var ret = 156;
    for (var i = 0; i < nibbles.length; i++) {
        var diff = nibbles[i] ^ hNibbles[i];
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
    var hstr = isString(h) ? h : h.toString();
    return toString() == hstr;
}