var parse = function(obj, path, region, cloud, accountId, resourceId) {
    // Enhanced path splitting: ensure [*] is always its own segment 
    if (typeof path === 'string') {
        // Split on . but keep [*] as its own segment
        // Example: networkAcls.ipRules[*].value => ['networkAcls', 'ipRules', '[*]', 'value']
        path = path
            .replace(/\[\*\]/g, '.[$*].') // temporarily mark wildcards
            .split('.')
            .filter(Boolean)
            .map(seg => seg === '[$*]' ? '[*]' : seg); // restore wildcard
    }
    
    if (Array.isArray(path) && path.length) {
        var localPath = path.shift();
        // Handle array wildcard syntax [*]
        if (localPath === '[*]') {
            if (Array.isArray(obj)) {
                var results = [];
                obj.forEach(function(item) {
                    var pathCopy = path.slice();
                    var result = parse(item, pathCopy, region, cloud, accountId, resourceId);
                    if (Array.isArray(result)) {
                        results = results.concat(result);
                    } else if (result !== 'not set') {
                        results.push(result);
                    }
                });
                return results.length > 0 ? results : 'not set';
            } else {
                return 'not set';
            }
        }
        if (obj && Object.prototype.hasOwnProperty.call(obj, localPath)) {
            return parse(obj[localPath], path, region, cloud, accountId, resourceId);
        } else {
            return 'not set';
        }
    } else if (Array.isArray(path) && path.length === 0) {
        return obj;
    } else if (!Array.isArray(obj) && path && path.length) {
        if (obj[path] || typeof obj[path] === 'boolean') return obj[path];
        else {
            if (cloud==='aws' && path.startsWith('arn:aws')) {
                const template_string = path;
                const placeholders = template_string.match(/{([^{}]+)}/g);
                let extracted_values = [];
                if (placeholders) {
                    extracted_values = placeholders.map(placeholder => {
                        const key = placeholder.slice(1, -1);
                        if (key === 'value') return [obj][0];
                        else return obj[key];
                    });
                }
                // Replace other variables
                let converted_string = template_string
                    .replace(/\{region\}/g, region)
                    .replace(/\{cloudAccount\}/g, accountId)
                    .replace(/\{resourceId\}/g, resourceId);
                placeholders.forEach((placeholder, index) => {
                    if (index === placeholders.length - 1) {
                        converted_string = converted_string.replace(placeholder, extracted_values.pop());
                    } else {
                        converted_string = converted_string.replace(placeholder, extracted_values.shift());
                    }
                });
                path = converted_string;
                return path;
            } else return 'not set';
        }
    } else if (Array.isArray(obj)) {
        return obj;
    } else {
        return obj;
    }
};
var transform = function(val, transformation) {
    if (transformation == 'DATE') {
        return new Date(val);
    } else if (transformation == 'INTEGER') {
        return parseInt(val);
    } else if (transformation == 'STRING') {
        return val.toString();
    } else if (transformation == 'DAYSFROM') {
        // Return the number of days between the date and now
        var now = new Date();
        var then = new Date(val);
        var timeDiff = then.getTime() - now.getTime();
        var diff = (Math.round(timeDiff / (1000 * 3600 * 24)));
        return diff;
    } else if (transformation == 'COUNT') {
        return val.length;
    } else if (transformation == 'EACH') {
        return val;
    } else if (transformation == 'TOLOWERCASE') {
        return val.toLowerCase();
    } else {
        return val;
    }
};

var compositeResult = function(inputResultsArr, resource, region, results, logical) {
    let failingResults = [];
    let passingResults = [];
    
    // No results to process, exit early
    if (!inputResultsArr || !inputResultsArr.length) {
        results.push({
            status: 2,
            resource: resource,
            message: 'No results to evaluate',
            region: region
        });
        return;
    }

    // If only one result, always use its status and message
    if (inputResultsArr.length === 1) {
        results.push({
            status: inputResultsArr[0].status,
            resource: resource,
            message: inputResultsArr[0].message,
            region: region
        });
        return;
    }
    
    inputResultsArr.forEach(localResult => {
        if (localResult.status === 2) {
            failingResults.push(localResult.message);
        }
        if (localResult.status === 0) {
            passingResults.push(localResult.message);
        }
    });

    if (!logical) {
        // Default behavior: if any resource fails, overall result is FAIL
        if (failingResults && failingResults.length) {
            results.push({
                status: 2,
                resource: resource,
                message: failingResults.join(' and '),
                region: region
            });
        } else {
            results.push({
                status: 0,
                resource: resource,
                message: passingResults.join(' and '),
                region: region
            });
        }
    } else if (logical === 'AND') {
        if (failingResults && failingResults.length) {
            results.push({
                status: 2,
                resource: resource,
                message: failingResults.join(' and '),
                region: region
            });
        } else {
            results.push({
                status: 0,
                resource: resource,
                message: passingResults.join(' and '),
                region: region
            });
        }
    } else {
        if (passingResults && passingResults.length) {
            results.push({
                status: 0,
                resource: resource,
                message: passingResults.join(' and '),
                region: region
            });
        } else {
            results.push({
                status: 2,
                resource: resource,
                message: failingResults.join(' and '),
                region: region
            });
        }
    }
};

var runValidation = function(obj, condition, inputResultsArr, nestedResultArr, region, cloud, accountId, resourceId) {
    let message = [];
    let conditionResult = 0; // Initialize conditionResult at function level

    // Extract the values for the conditions
    if (condition.property) {
        let property;
        if (Array.isArray(condition.property)) {
            if (condition.property.length === 1) {
                property = condition.property[0];
            } else if (condition.property.length > 1) {
                property = condition.property.slice(0);
            }
        } else {
            property = condition.property;
        }
        
        // Handle AliasTarget special cases
        if (typeof property === 'string' && property.includes('AliasTarget')) {
            const propertyParts = property.split('.');
            const aliasProperty = propertyParts.length > 1 ? propertyParts[1] : null;
            
            if (obj && obj.AliasTarget) {
                if (aliasProperty && obj.AliasTarget[aliasProperty] !== undefined) {
                    condition.parsed = obj.AliasTarget[aliasProperty];
                } else if (!aliasProperty) {
                    condition.parsed = obj.AliasTarget;
                } else {
                    condition.parsed = 'not set';
                }
            } else {
                condition.parsed = 'not set';
            }
        } else {
            const parseResult = parse(obj, condition.property, region, cloud, accountId, resourceId);
            condition.parsed = parseResult;
        }

        // Normalize: if property is wildcard and parse returned 'not set', treat as ['not set']
        if ((Array.isArray(condition.property) ? condition.property.join('.') : condition.property).includes('[*]') && condition.parsed === 'not set') {
            condition.parsed = ['not set'];
        }

        // Transform the property if required
        if (condition.transform) {
            try {
                condition.parsed = transform(condition.parsed, condition.transform);
            } catch (e) {
                conditionResult = 2;
                message.push(`${property}: unable to perform transformation`);
                let resultObj = {
                    status: conditionResult,
                    message: message.join(', ')
                };

                inputResultsArr.push(resultObj);
                return resultObj;
            }
        }

        if (condition.parsed === 'not set'){
            conditionResult = 2;
            message.push(`${condition.property}: not set to any value`);
        } else if ((typeof condition.parsed !== 'boolean' && !condition.parsed) && !Array.isArray(condition.parsed)){
            conditionResult = 2;
            message.push(`${property}: not set to any value`);
        }

        // Compare the property with the operator
        if (condition.op) {
            let userRegex;
            if (condition.op === 'MATCHES' || condition.op === 'NOTMATCHES') {
                userRegex = new RegExp(condition.value);
            }
            
            // Handle arrays returned by parse function (from wildcard paths)
            if (Array.isArray(condition.parsed)) {
                let anyMatch = false;
                let anyNotSet = false;
                let allNotSet = true;
                let arrayMessages = [];
                condition.parsed.forEach(function(item, index) {
                    let itemMatch = false;
                    if (item === 'not set') {
                        arrayMessages.push(`Item ${index}: not set`);
                        anyNotSet = true;
                    } else {
                        allNotSet = false;
                    }
                    if (condition.op && item !== 'not set') {
                        if (condition.op == 'EQ') {
                            itemMatch = (item == condition.value);
                        } else if (condition.op == 'NE') {
                            itemMatch = (item !== condition.value);
                        } else if (condition.op == 'CONTAINS') {
                            itemMatch = (item && item.includes && item.includes(condition.value));
                        } else if (condition.op == 'MATCHES') {
                            let userRegex = RegExp(condition.value);
                            itemMatch = userRegex.test(item);
                        } else if (condition.op == 'EXISTS') {
                            itemMatch = (item !== 'not set');
                        } else if (condition.op == 'ISTRUE') {
                            itemMatch = !!item;
                        } else if (condition.op == 'ISFALSE') {
                            itemMatch = !item;
                        }
                    }
                    if (itemMatch) {
                        arrayMessages.push(`Item ${index}: ${item} matched condition`);
                        anyMatch = true;
                    } else if (item !== 'not set') {
                        arrayMessages.push(`Item ${index}: ${item} did not match condition`);
                    }
                });

                if (condition.parsed.length === 0 || allNotSet) {
                    message.push(`${condition.property}: ${arrayMessages.join(', ')}`);
                    let resultObj = {
                        status: 2, // FAIL if array is empty or all items are not set (property missing everywhere)
                        message: message.join(', ')
                    };
                    inputResultsArr.push(resultObj);
                    return resultObj;
                } else if (anyMatch) {
                    message.push(`${condition.property}: ${arrayMessages.join(', ')}`);
                    let resultObj = {
                        status: 0, // PASS if any item matches and at least one is set
                        message: message.join(', ')
                    };
                    inputResultsArr.push(resultObj);
                    return resultObj;
                } else if (anyNotSet) {
                    message.push(`${condition.property}: ${arrayMessages.join(', ')}`);
                    let resultObj = {
                        status: 2, // FAIL if any item is not set
                        message: message.join(', ')
                    };
                    inputResultsArr.push(resultObj);
                    return resultObj;
                } else {
                    message.push(`${condition.property}: ${arrayMessages.join(', ')}`);
                    let resultObj = {
                        status: 2, // FAIL if none match and all are set
                        message: message.join(', ')
                    };
                    inputResultsArr.push(resultObj);
                    return resultObj;
                }
            }
            if (condition.transform && condition.transform == 'EACH' && condition) {
                if (condition.op == 'CONTAINS') {
                    var stringifiedCondition = JSON.stringify(condition.parsed);
                    if (condition.value && condition.value.includes(':')) {
                        var key = condition.value.split(/:(?!.*:)/)[0];
                        var value = condition.value.split(/:(?!.*:)/)[1];

                        if (stringifiedCondition.includes(key) && stringifiedCondition.includes(value)){
                            message.push(`${property}: ${condition.value} found in ${stringifiedCondition}`);
                            conditionResult = 0;
                        } else {
                            message.push(`${condition.value} not found in ${stringifiedCondition}`);
                            conditionResult = 2;
                        }
                    } else if (stringifiedCondition && stringifiedCondition.includes(condition.value)) {
                        message.push(`${property}: ${condition.value} found in ${stringifiedCondition}`); 
                        conditionResult = 0;
                    } else if (stringifiedCondition && stringifiedCondition.length){
                        message.push(`${condition.value} not found in ${stringifiedCondition}`);
                        conditionResult = 2;
                    } else {
                        message.push(`${condition.parsed} is not the right property type for this operation`);
                        conditionResult = 2;
                    }
                } else if (condition.op == 'NOTCONTAINS') {
                    var conditionStringified = JSON.stringify(condition.parsed);
                    if (condition.value && condition.value.includes(':')) {

                        var conditionKey = condition.value.split(/:(?!.*:)/)[0];
                        var conditionValue = condition.value.split(/:(?!.*:)/)[1];

                        if (conditionStringified.includes(conditionKey) && !conditionStringified.includes(conditionValue)){
                            message.push(`${property}: ${condition.value} not found in ${conditionStringified}`);
                            return 0;
                        } else {
                            message.push(`${condition.value} found in ${conditionStringified}`);
                            return 2;
                        }
                    } else if (conditionStringified && !conditionStringified.includes(condition.value)) {
                        message.push(`${property}: ${condition.value} not found in ${conditionStringified}`);
                        return 0;
                    } else if (conditionStringified && conditionStringified.length){
                        message.push(`${condition.value} found in ${conditionStringified}`);
                        return 2;
                    } else {
                        message.push(`${condition.parsed} is not the right property type for this operation`);
                        return 2;
                    }
                } else {
                    // Recurse into the same function
                    var subProcessed = [];
                    if (!condition.parsed.length) {
                        conditionResult = 2;
                        message.push(`${property}: is not iterable using EACH transformation`);
                    }  else {
                        condition.parsed.forEach(function(parsed) {
                            subProcessed.push(runValidation(parsed, condition, inputResultsArr, null, region, cloud, accountId, resourceId));
                        });
                        subProcessed.forEach(function(sub) {
                            if (sub.status) conditionResult = sub.status;
                            if (sub.message) message.push(sub.message);
                        });
                    }
                }
            } else if (condition.op == 'EQ') {
                if (condition.parsed == condition.value) {
                    message.push(`${property}: ${condition.parsed} matched: ${condition.value}`);
                    conditionResult = 0;
                } else {
                    // Check if we're comparing an object to a string - common user error
                    if (typeof condition.parsed === 'object' && condition.parsed !== null && typeof condition.value === 'string') {
                        message.push(`${property}: is an object but compared to string "${condition.value}". Consider using a more specific property path like "${property}.propertyName"`);
                    } else {
                        message.push(`${property}: ${condition.parsed} did not match: ${condition.value}`);
                    }
                    conditionResult = 2;
                }
            } else if (condition.op == 'GT') {
                // Convert to numbers for comparison if they are numeric strings
                let parsedVal = condition.parsed;
                let comparisonVal = condition.value;
                
                // Force numeric conversion
                parsedVal = Number(parsedVal);
                comparisonVal = Number(comparisonVal);
                
                if (parsedVal > comparisonVal) {
                    message.push(`${property}: count of ${condition.parsed} was greater than: ${condition.value}`);
                    conditionResult = 0;
                } else {
                    conditionResult = 2;
                    message.push(`${property}: count of ${condition.parsed} was not greater than: ${condition.value}`);
                }
            } else if (condition.op == 'LT') {
                // Convert to numbers for comparison if they are numeric strings
                let parsedVal = condition.parsed;
                let comparisonVal = condition.value;
                
                // Force numeric conversion
                parsedVal = Number(parsedVal);
                comparisonVal = Number(comparisonVal);
                
                if (parsedVal < comparisonVal) {
                    message.push(`${property}: count of ${condition.parsed} was less than: ${condition.value}`);
                    conditionResult = 0;
                } else {
                    conditionResult = 2;
                    message.push(`${property}: count of ${condition.parsed} was not less than: ${condition.value}`);
                }
            } else if (condition.op == 'NE') {
                if (condition.parsed !== condition.value) {
                    message.push(`${property}: ${condition.parsed} is not: ${condition.value}`);
                    conditionResult = 0;
                } else {
                    conditionResult = 2;
                    // Check if we're comparing an object to a string - common user error
                    if (typeof condition.parsed === 'object' && condition.parsed !== null && typeof condition.value === 'string') {
                        message.push(`${property}: is an object but compared to string "${condition.value}". Consider using a more specific property path like "${property}.propertyName"`);
                    } else {
                        message.push(`${property}: ${condition.parsed} is: ${condition.value}`);
                    }
                }
            } else if (condition.op == 'MATCHES') {
                if (userRegex.test(condition.parsed)) {
                    message.push(`${property}: ${condition.parsed} matches the regex: ${condition.value}`);
                    conditionResult = 0;
                } else {
                    conditionResult = 2;
                    message.push(`${property}: ${condition.parsed} does not match the regex: ${condition.value}`);
                }
            } else if (condition.op == 'NOTMATCHES') {
                if (!userRegex.test(condition.parsed)) {
                    message.push(`${condition.property}: ${condition.parsed} does not match the regex: ${condition.value}`);
                    conditionResult = 0;
                } else {
                    conditionResult = 2;
                    message.push(`${condition.property}: ${condition.parsed} matches the regex : ${condition.value}`);
                }
            } else if (condition.op == 'EXISTS') {
                if (condition.parsed !== 'not set') {
                    message.push(`${property}: set to ${condition.parsed}`);
                    conditionResult = 0;
                } else {
                    message.push(`${property}: ${condition.parsed}`);
                    conditionResult = 2;
                }
            } else if (condition.op == 'ISTRUE') {
                if (typeof condition.parsed == 'boolean' && condition.parsed) {
                    message.push(`${property} is true`);
                    conditionResult = 0;
                } else if (typeof condition.parsed == 'boolean' && !condition.parsed) {
                    conditionResult = 2;
                    message.push(`${property} is false`);
                } else {
                    message.push(`${property} is not a boolean value`);
                    conditionResult = 2;
                }
            } else if (condition.op == 'ISFALSE') {
                if (typeof condition.parsed == 'boolean' && !condition.parsed) {
                    message.push(`${property} is false`);
                    conditionResult = 0;
                } else if (typeof condition.parsed == 'boolean' && condition.parsed) {
                    conditionResult = 2;
                    message.push(`${property} is true`);
                } else {
                    message.push(`${property} is not a boolean value`);
                    conditionResult = 2;
                }
            } else if (condition.op == 'CONTAINS') {
                if (condition.parsed && condition.parsed.length && condition.parsed.includes(condition.value)) {
                    message.push(`${property}: ${condition.value} found in ${condition.parsed}`);
                    conditionResult = 0;
                } else if (condition.parsed && condition.parsed.length){
                    message.push(`${condition.value} not found in ${condition.parsed}`);
                    conditionResult = 2;
                } else {
                    // Check if we're trying to use CONTAINS on an object - common user error
                    if (typeof condition.parsed === 'object' && condition.parsed !== null && !Array.isArray(condition.parsed)) {
                        message.push(`${property}: is an object, not a string or array. CONTAINS operation requires a string or array. Consider using a more specific property path like "${property}.propertyName"`);
                    } else {
                        message.push(`${condition.parsed} is not the right property type for this operation`);
                    }
                    conditionResult = 2;
                }
            } else if (condition.op == 'NOTCONTAINS') {
                if (condition.parsed && condition.parsed.length && !condition.parsed.includes(condition.value)) {
                    message.push(`${property}: ${condition.value} not found in ${condition.parsed}`);
                    conditionResult = 0;
                } else if (condition.parsed && condition.parsed.length){
                    message.push(`${condition.value} found in ${condition.parsed}`);
                    conditionResult = 2;
                } else {
                    message.push(`${condition.parsed} is not the right property type for this operation`);
                    conditionResult = 2;
                }
            }
        }
    }

    if (!message.length) {
        message = ['The resource matched all required conditions'];
    }

    let resultObj = {
        status: conditionResult,
        message: message.join(', ')
    };

    inputResultsArr.push(resultObj);
    return resultObj;
};

var runConditions = function(input, data, results, resourcePath, resourceName, region, cloud, accountId) {
    let parsedResource = resourceName;
    let inputResultsArr = [];
    let logical;
    let localInput = JSON.parse(JSON.stringify(input));

    // to check if top level * matches. ex: Instances[*] should be
    // present in each condition if not its impossible to compare resources
    
    localInput.conditions.forEach(condition => {
        logical = condition.logical;
        
        // Special handling for ResourceRecordSets[*].AliasTarget.* properties
        if (condition.property && condition.property.includes('ResourceRecordSets[*].AliasTarget')) {
            let foundMatch = false;
            let matchResults = [];
            let nonMatchResults = [];
            
            if (data && data.ResourceRecordSets && Array.isArray(data.ResourceRecordSets)) {
                // Directly access ResourceRecordSets if it exists at the top level
                for (let i = 0; i < data.ResourceRecordSets.length; i++) {
                    let record = data.ResourceRecordSets[i];
                    if (record && record.AliasTarget) {
                        // Extract just the AliasTarget part of the property path
                        const aliasProperty = condition.property.split('AliasTarget.')[1];
                        
                        if (aliasProperty && record.AliasTarget[aliasProperty]) {
                            let propValue = record.AliasTarget[aliasProperty];
                            let result = 2; // Default to fail
                            let message = '';
                            
                            // Perform the actual comparison
                            if (condition.op === 'CONTAINS' && propValue.includes(condition.value)) {
                                result = 0;
                                message = `${aliasProperty}: ${condition.value} found in ${propValue}`;
                                foundMatch = true;
                                matchResults.push({
                                    status: result,
                                    message: message,
                                    resource: record.Name || resourceName
                                });
                            } else if (condition.op === 'NOTCONTAINS' && !propValue.includes(condition.value)) {
                                result = 0;
                                message = `${aliasProperty}: ${condition.value} not found in ${propValue}`;
                                foundMatch = true;
                                matchResults.push({
                                    status: result,
                                    message: message,
                                    resource: record.Name || resourceName
                                });
                            } else if (condition.op === 'EQ' && propValue === condition.value) {
                                result = 0;
                                message = `${aliasProperty}: ${propValue} matched: ${condition.value}`;
                                foundMatch = true;
                                matchResults.push({
                                    status: result,
                                    message: message,
                                    resource: record.Name || resourceName
                                });
                            } else if (condition.op === 'NE' && propValue !== condition.value) {
                                result = 0;
                                message = `${aliasProperty}: ${propValue} is not: ${condition.value}`;
                                foundMatch = true;
                                matchResults.push({
                                    status: result,
                                    message: message,
                                    resource: record.Name || resourceName
                                });
                            } else if (condition.op === 'GT') {
                                // Convert to numbers for comparison if they are numeric strings
                                let parsedVal = Number(propValue);
                                let comparisonVal = Number(condition.value);
                                
                                if (!isNaN(parsedVal) && !isNaN(comparisonVal) && parsedVal > comparisonVal) {
                                    result = 0;
                                    message = `${aliasProperty}: ${propValue} was greater than: ${condition.value}`;
                                    foundMatch = true;
                                    matchResults.push({
                                        status: result,
                                        message: message,
                                        resource: record.Name || resourceName
                                    });
                                } else {
                                    message = `${aliasProperty}: ${propValue} was not greater than: ${condition.value}`;
                                    nonMatchResults.push({
                                        status: 2,
                                        message: message,
                                        resource: record.Name || resourceName
                                    });
                                }
                            } else if (condition.op === 'LT') {
                                // Convert to numbers for comparison if they are numeric strings
                                let parsedVal = Number(propValue);
                                let comparisonVal = Number(condition.value);
                                
                                if (!isNaN(parsedVal) && !isNaN(comparisonVal) && parsedVal < comparisonVal) {
                                    result = 0;
                                    message = `${aliasProperty}: ${propValue} was less than: ${condition.value}`;
                                    foundMatch = true;
                                    matchResults.push({
                                        status: result,
                                        message: message,
                                        resource: record.Name || resourceName
                                    });
                                } else {
                                    message = `${aliasProperty}: ${propValue} was not less than: ${condition.value}`;
                                    nonMatchResults.push({
                                        status: 2,
                                        message: message,
                                        resource: record.Name || resourceName
                                    });
                                }
                            } else if (condition.op === 'ISTRUE') {
                                if (typeof propValue === 'boolean' && propValue === true) {
                                    result = 0;
                                    message = `${aliasProperty} is true`;
                                    foundMatch = true;
                                    matchResults.push({
                                        status: result,
                                        message: message,
                                        resource: record.Name || resourceName
                                    });
                                } else if (typeof propValue === 'string' && 
                                          (propValue.toLowerCase() === 'true' || propValue === '1')) {
                                    result = 0;
                                    message = `${aliasProperty} is true (${propValue})`;
                                    foundMatch = true;
                                    matchResults.push({
                                        status: result,
                                        message: message,
                                        resource: record.Name || resourceName
                                    });
                                } else {
                                    message = `${aliasProperty} is not true`;
                                    nonMatchResults.push({
                                        status: 2,
                                        message: message,
                                        resource: record.Name || resourceName
                                    });
                                }
                            } else if (condition.op === 'ISFALSE') {
                                if (typeof propValue === 'boolean' && propValue === false) {
                                    result = 0;
                                    message = `${aliasProperty} is false`;
                                    foundMatch = true;
                                    matchResults.push({
                                        status: result,
                                        message: message,
                                        resource: record.Name || resourceName
                                    });
                                } else if (typeof propValue === 'string' && 
                                          (propValue.toLowerCase() === 'false' || propValue === '0')) {
                                    result = 0;
                                    message = `${aliasProperty} is false (${propValue})`;
                                    foundMatch = true;
                                    matchResults.push({
                                        status: result,
                                        message: message,
                                        resource: record.Name || resourceName
                                    });
                                } else {
                                    message = `${aliasProperty} is not false`;
                                    nonMatchResults.push({
                                        status: 2,
                                        message: message,
                                        resource: record.Name || resourceName
                                    });
                                }
                            } else if (condition.op === 'EXISTS') {
                                result = 0;
                                message = `${aliasProperty}: set to ${propValue}`;
                                foundMatch = true;
                                matchResults.push({
                                    status: result,
                                    message: message,
                                    resource: record.Name || resourceName
                                });
                            } else if (condition.op === 'MATCHES' && new RegExp(condition.value).test(propValue)) {
                                result = 0;
                                message = `${aliasProperty}: ${propValue} matches the regex: ${condition.value}`;
                                foundMatch = true;
                                matchResults.push({
                                    status: result,
                                    message: message,
                                    resource: record.Name || resourceName
                                });
                            } else if (condition.op === 'NOTMATCHES' && !new RegExp(condition.value).test(propValue)) {
                                result = 0;
                                message = `${aliasProperty}: ${propValue} does not match the regex: ${condition.value}`;
                                foundMatch = true;
                                matchResults.push({
                                    status: result,
                                    message: message,
                                    resource: record.Name || resourceName
                                });
                            } else {
                                if (condition.op === 'CONTAINS') {
                                    message = `${condition.value} not found in ${propValue}`;
                                } else if (condition.op === 'NOTCONTAINS') {
                                    message = `${condition.value} found in ${propValue}`;
                                } else if (condition.op === 'EQ') {
                                    message = `${aliasProperty}: ${propValue} did not match: ${condition.value}`;
                                } else if (condition.op === 'NE') {
                                    message = `${aliasProperty}: ${propValue} is: ${condition.value}`;
                                } else if (condition.op === 'GT') {
                                    message = `${aliasProperty}: ${propValue} was not greater than: ${condition.value}`;
                                } else if (condition.op === 'LT') {
                                    message = `${aliasProperty}: ${propValue} was not less than: ${condition.value}`;
                                } else if (condition.op === 'ISTRUE') {
                                    message = `${aliasProperty} is not true`;
                                } else if (condition.op === 'ISFALSE') {
                                    message = `${aliasProperty} is not false`;
                                } else if (condition.op === 'MATCHES') {
                                    message = `${aliasProperty}: ${propValue} does not match the regex: ${condition.value}`;
                                } else if (condition.op === 'NOTMATCHES') {
                                    message = `${aliasProperty}: ${propValue} matches the regex: ${condition.value}`;
                                }
                                
                                nonMatchResults.push({
                                    status: 2,
                                    message: message,
                                    resource: record.Name || resourceName
                                });
                            }
                        } else if (!aliasProperty) {
                            // Handle the entire AliasTarget object
                            matchResults.push({
                                status: 0,
                                message: `AliasTarget: exists for record ${record.Name}`,
                                resource: record.Name || resourceName
                            });
                            foundMatch = true;
                        }
                    }
                }
            }
            
            // After checking all records, add the appropriate results to inputResultsArr
            if (foundMatch) {
                // If any record matched, add all matching results
                matchResults.forEach(result => {
                    inputResultsArr.push({
                        status: result.status,
                        message: result.message
                    });
                    parsedResource = result.resource;
                });
            } else {
                // If no records matched, add a failure result
                if (nonMatchResults.length > 0) {
                    // Use the first non-matching result as the representative failure
                    inputResultsArr.push({
                        status: 2,
                        message: nonMatchResults[0].message
                    });
                    parsedResource = nonMatchResults[0].resource;
                } else {
                    // No records with AliasTarget found
                    inputResultsArr.push({
                        status: 2,
                        message: `No matching records with AliasTarget.${condition.property.split('AliasTarget.')[1] || ''} found`
                    });
                }
            }
        } else if (condition.property && condition.property.includes('[*]')) {
            // For wildcard properties, parse once and validate the result
            const parseResult = parse(data, condition.property, region, cloud, accountId, resourceName);
            condition.parsed = parseResult;
            condition.validated = runValidation(data, condition, inputResultsArr, null, region, cloud, accountId, resourceName);
            parsedResource = parse(data, resourcePath, region, cloud, accountId, resourceName);
            if (typeof parsedResource !== 'string' || parsedResource === 'not set') parsedResource = resourceName;
        } else {
            // For non-wildcard properties, use the same logic as wildcard
            condition.validated = runValidation(data, condition, inputResultsArr, null, region, cloud, accountId, resourceName);
            parsedResource = parse(data, resourcePath, region, cloud, accountId, resourceName);
            if (typeof parsedResource !== 'string' || parsedResource === 'not set') parsedResource = resourceName;
        }
    });

    compositeResult(inputResultsArr, parsedResource, region, results, logical);
};

var asl = function(source, input, resourceMap, cloud, accountId, callback) {
    if (!source || !input) return callback('No source or input provided');
    if (!input.apis || !input.apis[0]) return callback('No APIs provided for input');
    if (!input.conditions || !input.conditions.length) return callback('No conditions provided for input');
    let service = input.conditions[0].service;
    var subService = (input.conditions[0].subservice) ? input.conditions[0].subservice : null;
    let api = input.conditions[0].api;
    let resourcePath;
    if (resourceMap &&
        resourceMap[service] &&
        resourceMap[service][api]) {
        resourcePath = resourceMap[service][api];
    }

    if (!source[service]) return callback(`Source data did not contain service: ${service}`);
    if (subService && !source[service][subService]) return callback(`Source data did not contain service: ${service}:${subService}`);
    if (subService && !source[service][subService][api]) return callback(`Source data did not contain API: ${api}`);
    if (!subService && !source[service][api]) return callback(`Source data did not contain API: ${api}`);

    var results = [];
    let data = subService ? source[service][subService][api] : source[service][api];

    for (let region in data) {
        let regionVal = data[region];
        if (typeof regionVal !== 'object') continue;
        if (regionVal.err) {
            results.push({
                status: 3,
                message: regionVal.err.message || 'Error',
                region: region
            });
        } else if (regionVal.data && regionVal.data.length) {
            regionVal.data.forEach(function(regionData) {
                var resourceName = parse(regionData, resourcePath, region, cloud, accountId)[0];
                runConditions(input, regionData, results, resourcePath, resourceName, region, cloud, accountId);
            });
        } else if (regionVal.data && Object.keys(regionVal.data).length) {
            runConditions(input, regionVal.data, results, resourcePath, '', region, cloud, accountId);
        } else {
            if (!Object.keys(regionVal).length || (regionVal.data && (!regionVal.data.length || !Object.keys(regionVal.data).length))) {
                results.push({
                    status: 0,
                    message: 'No resources found in this region',
                    region: region
                });
            } else {
                for (let resourceName in regionVal) {
                    let resourceObj = regionVal[resourceName];
                    if (resourceObj.err || !resourceObj.data) {
                        results.push({
                            status: 3,
                            resource: resourceName,
                            message: resourceObj.err.message || 'Error',
                            region: region
                        });
                    } else {
                        if (resourceObj.data && resourceObj.data.length){
                            resourceObj.data.forEach(function(regionData) {
                                var resourceName = parse(regionData, resourcePath, region, cloud, accountId)[0];
                                runConditions(input, regionData, results, resourcePath, resourceName, region, cloud, accountId);
                            });
                        } else {
                            runConditions(input, resourceObj.data, results, resourcePath, resourceName, region, cloud, accountId);
                        }
                    }
                }
            }
        }
    }

    callback(null, results, data);
};

module.exports = asl;
