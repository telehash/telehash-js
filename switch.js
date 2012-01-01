var async = require('async');
var hash = require('./hash');

// default timer settings, in seconds
var timers = {
    cleanup: 65,
}

// global hash of all known switches by ipp or hash
var network = {};

// callbacks must be set first, and must have .data({telex for app}) and .send() being udp socket send
var master = {data:function(){}, sock:{send:function(){}}};
exports.setCallbacks = function(m)
{
    master = m;
}

// return array of all
function getSwitches()
{
    var arr = [];
    Object.keys(network).forEach(function(key){
        arr.push(network[key]);
    });
    return arr;
}
exports.getSwitches = getSwitches;

function getSwitch(ipp)
{
    if(network[ipp]) return network[ipp];
    return new Switch(ipp);
    // create new one!
}
exports.getSwitch = getSwitch;

// return array of switches closest to the hash, s (optional optimized staring switch), num (default 5, optional)
function getNear(hash, s, num)
{
    // use mesh, also can sort whole network, also can use a dirty list mixed with mesh

}
exports.getNear = getNear;

// every seen IPP becomes a switch object that maintains itself
function Switch(ipp, via)
{
    // initialize the absolute minimum here to keep this lightweight as it's used all the time
    this.ipp = ipp;
    this.hash = new hash.Hash(ipp);
    network[this.ipp] = this;
    this.end = this.hash.toString();
    this.via = via; // optionally, which switch introduced us
    this.tCleanup = setTimeout(this.timerCleanup, timers.cleanup*1000);
    return this;
}
exports.Switch = Switch;


// process incoming telex from this switch
Switch.prototype.process = function(telex)
{
    if(!validate(this, telex)) return;
    telex._ = this; // async eats this
    if(!this.queue) this.queue = async.queue(worker, 1);
    this.queue.push(telex);
}

function worker(telex, callback)
{
    var s = telex._; delete telex._; // repair
    // once handshake, activate
    console.error(s.ipp+"\t"+JSON.stringify(telex));
    s.send({hello:'world'});
    callback();
}

Switch.prototype.send = function(telex)
{
    // check bytes sent vs received and drop if too much so we don't flood
    if(!this.Bsent) this.Bsent = 0;
    if(this.Bsent - this.BRin > 10000) {
        console.error("FLOODING "+this.ipp+", dropping "+JSON.stringify(telex));
        return;
    }

    if(!this.ring) this.ring = Math.floor((Math.random() * 32768) + 1);

    telex._to = this.ipp;
    (this.active) ? telex._line = this.line : telex._ring = this.ring;

    // send the bytes we've received, if any
    if(this.BR) telex._br = this.BRout = this.BR;

    var msg = new Buffer(JSON.stringify(telex)+'\n', "utf8"); // \n is nice for testing w/ netcat

    if(msg.length > 1400) console.error("WARNING, large datagram might not survive MTU "+msg.length);

    // track bytes we've sent
    if(!this.Bsent) this.Bsent = 0;
    this.Bsent += msg.length;
    this.ATsent = Date.now();

    // convenience to parse out once
    if(!this.ip)
    {
        this.ip = this.ipp.substr(0, this.ipp.indexOf(':'));
        this.port = parseInt(this.ipp.substr(this.ipp.indexOf(':')+1));
    }
    console.error(this.ip+" "+this.port+" "+msg.toString());
    master.sock.send(msg, 0, msg.length, this.port, this.ip);
}

// clean up
Switch.prototype.timerInactive = function()
{
    // if not in use, not active, destruct
}

Switch.prototype.destruct = function()
{
    // delete self, if active try to send goodbye
    clearTimeout(this.tCleanup);
    delete network[this.ipp];
    // if meshed, remove all back references
}

function activate(s)
{
    s.active = true;
    // adjust timers
}

function validate(s, telex)
{
    // doo stuff
    return true;
}