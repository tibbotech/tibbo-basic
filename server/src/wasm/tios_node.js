const ntios = {};
global.ntios = ntios;
ntios.sys = {};
ntios.sys.debugprint = function(str) {
    console.log("printed", str);
};