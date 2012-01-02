var async = require('async');
var hash = require('./hash');

// default timer settings, in seconds
var timers = {
    cleanup: 65,
}

// global hash of all known switches by ipp or hash
var network = {};

// callbacks must be set first, and must have .data({telex for app}) and .send() being udp socket send, news(switch) for new switch creation
var master = {data:function(){}, sock:{send:function(){}}, news:function(){}};
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
    master.news(this);
    return this;
}
exports.Switch = Switch;


// process incoming telex from this switch
Switch.prototype.process = function(telex, rawlen)
{
    // basic header tracking
    if(!this.BR) this.BR = 0;
    this.BR += rawlen;

    // do all the integrity and line validation stuff
    if(!validate(this, telex)) return;

    // process serially per switch
    telex._ = this; // async eats this
    if(!this.queue) this.queue = async.queue(worker, 1);
    this.queue.push(telex);
}

function worker(telex, callback)
{
    var s = telex._; delete telex._; // get owning switch, repair
console.error(s.ipp+"\t"+JSON.stringify(telex));
//s.send({hello:'world'});

    // track some basics
    this.BRin = (telex._br) ? parseInt(telex._br) : undefined;

    // process reactionables!
    if(telex['+end']) doEnd(s, new hash.Hash(telex['+end']), parseInt(telex['_hop']));
    if(Array.isArray(telex['.see'])) doSee(s, telex['.see']);
    if(s.active && Array.isArray(telex['.tap'])) doTap(s, telex['.tap']);

    // if there's any signals, check for matching taps to relay to
    if(Object.keys(telex).some(function(x){ return x[0] == '+' }) && !(parseInt(telex['_hop']) >= 4)) doSignals(s, telex);

    // if there's any raw data, send to master
    if(Object.keys(telex).some(function(x){ return (x[0] != '+' && x[0] != '.' && x[0] != '_') })) master.data(s, telex);

    callback();
}

function doEnd(s, end, hop)
{
    if(h)
}

function doSee(s, see)
{
    see.forEach(function(ipp){
        if(network[ipp]) return;
        new Switch(ipp, s.ipp);
    });
}

function doTap(s, tap)
{
    // do some validation?
    // todo: index these much faster
    s.rules = tap;
}

function doSignals(s, telex)
{
    // find any rules and match, relay just the signals
    // TODO, check our master.NAT rule, if it matches, parse the th:ipp and send them an empty telex to pop!
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

// keepalives
Switch.prototype.timerActive = function()
{
    // if tap/natted, add to any existing outgoing taps or create one
    // reset timer based on last send n max wait
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