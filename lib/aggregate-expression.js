'use strict';

/**
 * Parser and other utilities for aggregate expression of the format 'fn[:field]'
 *
 * Valid fields are any objects with properties { name: string, label: string, dataType: string('date', 'number',...) }
 * Data types are checked for values 'date', 'number'
 */

const _ = require('lodash');
const joi = require('joi');
const Aggregation = require('./aggregation').Aggregation;

const COUNT = 'count', SUM = 'sum', AVG = 'avg', MAX = 'max', MIN = 'min';

var internals = {};

/**
 * Generates a list of valid aggregate expressions for a collection of fields
 * @param fields
 * @return {*}
 */
internals.valids = function(fields) {
    return _(fields)
        .filter(f => f.dataType === 'number' || f.dataType === 'date')
        .reduce(function (acc, f) {
            acc.push(`${MAX}:${f.name}`);
            acc.push(`${MIN}:${f.name}`);

            if (f.dataType == 'number') {
                acc.push(`${SUM}:${f.name}`);
                acc.push(`${AVG}:${f.name}`);
            }

            return acc;
        }, [COUNT]);
};

/**
 * Represents an aggregate expression
 * @param {'count'|'sum'|'avg'|'max'|'min'} fn the aggregate function
 * @param {{ name: string, label: string, dataType: string}=} field the field being aggregated
 * @constructor
 */
function AggregateExpression(fn, field) {
    this.fn = fn;
    this.field = field;
}

/**
 * Returns a label for the expression
 * @return {*}
 */
AggregateExpression.prototype.label = function() {
    switch (this.fn) {
        case COUNT:
            return 'Total Count';
        case SUM:
            return 'Total ' + this.field.label;
        case AVG:
            return 'Average ' + this.field.label;
        case MAX:
            return 'Max ' + this.field.label;
        case MIN:
            return 'Min ' + this.field.label;
        default:
            return 'Unknown';
    }
};

/**
 * If present, returns the field's label. Undefined otherwise
 * @return {string}
 */
AggregateExpression.prototype.fieldLabel = function() {
    return this.field && this.field.label;
};

/**
 * Returns the shorthand expression (e.g. 'sum:amount')
 * @return {string}
 */
AggregateExpression.prototype.toString = function() {
    return this.fn === COUNT ? COUNT : `${this.fn}:${this.field.name}`;
};

/**
 * Applies an aggregate expression to an aggregation. Adds an ES aggregation to the query payload and configures
 * a mapper to parse the result
 * @param agg the Aggregation to add the expression to
 * @param {function =} mapper a mapping function that accepts (label, value). By default a {label: string, value: number} tuple will be used
 * @return {*}
 */
AggregateExpression.prototype.apply = function(agg, mapper) {
    const defaultMapper = (label, value) => ({ label: label, value: value });
    const aggId = this.toString();

    mapper = mapper || defaultMapper;

    if (this.fn !== COUNT) {
        agg.aggregation(aggId, { [this.fn]: { field: this.field.name } })
            .configure({ order: { [ aggId ]: 'desc' }})
            .mapper(Aggregation.bucketMapper((b, v) => mapper(b.key, v[aggId])));
    } else {
        agg.mapper(Aggregation.bucketMapper(b => mapper(b.key, b.doc_count)));
    }

    return agg;
};

/**
 * Parses a string shorthand into an AggregateExpression
 * @param fields an array or hash of fields
 * @param {string} expr an aggregate expression string
 * @return {AggregateExpression}
 */
AggregateExpression.parse = function(fields, expr) {
    joi.assert(expr, joi.string().valid(internals.valids(fields)));
    let parts = expr.split(':');
    return new AggregateExpression(parts[0], _.find(fields, { name: parts[1] }));
};

/**
 * Returns a count expression
 * @return {AggregateExpression}
 */
AggregateExpression.count = function() {
    return new AggregateExpression(COUNT);
};

/**
 * Returns a sum expression
 * @param field
 * @return {AggregateExpression}
 */
AggregateExpression.sum = function(field) {
    return new AggregateExpression(SUM, field);
};

/**
 * Returns an average expression
 * @param field
 * @return {AggregateExpression}
 */
AggregateExpression.avg = function(field) {
    return new AggregateExpression(AVG, field);
};

/**
 * Returns a max expression
 * @param field
 * @return {AggregateExpression}
 */
AggregateExpression.max = function(field) {
    return new AggregateExpression(MAX, field);
};

/**
 * Returns a min expression
 * @param field
 * @return {AggregateExpression}
 */
AggregateExpression.min = function(field) {
    return new AggregateExpression(MIN, field);
};

/**
 * Builds a list of all possible aggregate expressions against a collection of fields
 * @param fields a hash or array of fields
 * @param {string[] =} fns an optional array of functions to be considered (defaults to ['count', 'sum', 'avg', 'max', 'min'])
 * @return {Array.<T>}
 */
AggregateExpression.of = function(fields, fns) {
    fns = fns || [COUNT, SUM, AVG, MAX, MIN];

    let numberFns = _.difference(fns, [COUNT]);
    let dateFns = _.difference(fns, [COUNT, SUM, AVG]);

    let countExprs = _.intersection(fns, [COUNT]).map(() => AggregateExpression.count());

    let numberExprs = _.filter(fields, { dataType: 'number' })
        .reduce(function (acc, field) {
            return acc.concat(numberFns.map(fn => new AggregateExpression(fn, field)));
        }, []);

    let dateExprs = _.filter(fields, { dataType: 'date' })
        .reduce(function (acc, field) {
            return acc.concat(dateFns.map(fn => new AggregateExpression(fn, field)));
        }, []);

    return countExprs.concat(numberExprs).concat(dateExprs);
};

exports.AggregateExpression = AggregateExpression;