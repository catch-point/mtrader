# ptrading
Technical Market Data Analysis Tool data uses Yahoo! financial data and other
sources to retreive and manipulate data locally for personal use.

## Instalation

> npm install ptrading/ptrading -g

## Usage

ptrading can be used as a node.js library, as a command line utility or as an interactive shell. All shell commands include a coresponding help command that explains the available arguments and features with some usage documentation.

```
const ptrading = require('ptrading');

// lookup exchange for a symbol and search for similar symbols
ptrading.lookup({symbol: 'YHOO'}).then(suggestions => {
  suggestions.forEach(suggestion => {
    console.log(suggestion.symbol, suggestion.exchange, suggestion.name); // YHOO NASDAQ Yahoo! Inc.
  });
});

// fundamental
ptrading.fundamental({
  symbol: 'YHOO',
  exchange: 'NASDAQ'
}).then(security => {
  console.log(security.name, security.EarningsShare); // Yahoo! Inc. -5.08
});

// fetch day, week, month, quarter, or year historic data about a symbol
ptrading.fetch({
  interval: 'day',
  symbol: 'YHOO',
  exchange: 'NASDAQ'
}).then(bars => {
  bars.forEach(bar => {
    console.log(bar.ending, bar.open, bar.high, bar.low, bar.close, bar.volume);
  });
});
/*
2017-01-03T16:00:00-05:00 39.11 39.18 38.64 38.9 6082600
2017-01-04T16:00:00-05:00 39 40.25 38.92 40.06 11724500
2017-01-05T16:00:00-05:00 40.31 41.37 40.24 41.34 13118500
2017-01-06T16:00:00-05:00 41.25 41.34 40.85 41.23 6085800
2017-01-09T16:00:00-05:00 41.17 41.66 41.13 41.34 7796300
2017-01-10T16:00:00-05:00 41.89 42.37 41.54 42.3 8110900
2017-01-11T16:00:00-05:00 42.27 42.59 42.07 42.59 6943900
2017-01-12T16:00:00-05:00 42.34 42.46 41.7 42.11 6023700
2017-01-13T16:00:00-05:00 42.11 42.46 42.02 42.27 4132100
*/

// set storage location for computations
ptrading.config('prefix', '/tmp/ptrading');

// retrieve historic data using custom columns and filtering
ptrading.quote({
  symbol: 'YHOO',
  exchange: 'NASDAQ',
  pad_begin: 9,       // Show today and nine earlier trading days
  columns: [
      'DATE(ending) AS "Date"',
      'day.close AS "Close"',
      '(day.adj_close - OFFSET(1, day.adj_close))*100/OFFSET(1,day.adj_close) AS "Change"'
  ].join(','),
  criteria: 'day.adj_close > OFFSET(1, day.adj_close)'
}).then(bars => {
  bars.forEach(bar => {
    console.log(bar.Date, bar.Close, bar.Change);
  });
});
/*
2016-12-30 38.67 0.0776371655703111
2017-01-03 38.9 0.5947866870849101
2017-01-04 40.06 2.9820024173777653
2017-01-05 41.34 3.1952046132000937
2017-01-09 41.34 0.266796022313865
2017-01-10 42.3 2.3222036768263092
2017-01-11 42.59 0.685581576491299
2017-01-13 42.27 0.3799548710530931
*/

// calculate hypothetical trades for a portfolio
ptrading.collect(["2017-01-09"], {
  portfolio: 'YHOO.NASDAQ,IBM.NYSE',
  end: "2017-01-14",
  precedence: 'PF(120,day.adj_close)',
  columns: [
      'symbol',
      'DATE(ending) AS date',
      'IF(COUNT(symbol)<=1,FLOOR(10000/(day.close)),0) AS target',
      'IF(ABS(target-PREV("position",0))<10,0,target-PREV("position",0)) AS shares',
      'PREV("position",0) + shares AS position',
      'day.close + 0.02 * IF(shares>0,1,-1) AS price', // includes slippage
      '-shares * price AS proceeds',
      'IF(shares=0,0, MAX(shares * 0.005, 1.00)) AS commission',
      'IF(position=0,PREV("basis",price),(PREV("basis")*PREV("position")+price*shares)/position) AS basis',
      'PREV("profit",0) + (price - PREV("price",0)) * PREV("position",0) - commission AS profit'
  ].join(','),
  retain: 'position OR shares'
}).then(trades => {
  trades.forEach(trade => {
    console.log(trade.symbol, trade.date, trade.shares, trade.price, trade.proceeds, trade.commission);
  });
});
/*
YHOO 2017-01-09  241  41.36 -9967.76 1.20
IBM  2017-01-10   60 165.54 -9932.40 1
YHOO 2017-01-10 -241  42.27 10189.47 1
YHOO 2017-01-11  234  42.61 -9970.74 1.17
IBM  2017-01-11  -60 167.73 10063.8  1
YHOO 2017-01-12    0  42.08       0  0
IBM  2017-01-13   59 167.36 -9874.24 1
YHOO 2017-01-13 -234  42.25  9886.5  1
*/

// close down helper threads
ptrading.close();
```

## Expressions ##
An expression is any combination of field, constants, and function calls connected by an operator or operators.

A constant can be a number or a quoted string.

A function call has a name followed parentheses enclosed comma separated list of expressions.

A field can be one of the following without a prefix:

```
      symbol    Represents the symbol used by the exchange
      exchange  Represents the exchange acronym
      ending    Represents the dateTime of when an interval ended
```
A field can also be one of the following prefixed by an interval:

```
      <interval>.ending     DateTime when the interval ends (interval prefix is optional)
      <interval>.open       Price when the interval began
      <interval>.high       highest price during the interval
      <interval>.low        Lowest price during the interval
      <interval>.close      Price when the interval ended
      <interval>.volume     Volume during the interval
      <interval>.adj_close  Close price adjusted for dividends and splits
```
An `<interval>` can be one of the following:

```
      year        Yearly quotes for security
      quarter     Quarterly quotes for security
      month       Monthly quotes for security
      week        Weekly quotes for security
      day         Daily quotes for security
      mX          Intraday quotes for security by X minutes
```
Operators include the following:

```
      OR   0 if both expressions are 0.
      AND  0 if either expression is 0.
      =    0 if both expressions have the same value.
      !=   0 if either expression has a different value.
      <>   0 if either expression has a different value.
      <=   0 if the left expression is larger than the right.
      >=   0 if the right expression is larger than the left.
      <    0 if the left expression is larger than or equal to the right.
      >    0 if the right expression is larger than or equal to the left.
      +    Adds both values together.
      -    Subtracts the right value from the left value.
      *    Multiples the values together.
      /    Divides the right values into the left value.
      %    Returns the integer remainder of a division
      !    0 if the expression was not zero
      ()   Groups expressions together to possibly change their precedence.
```
See the following help commands for function descriptions:
```
    help common-functions  
    help lookback-functions  
    help indicator-functions  
    help aggregate-functions  
```
