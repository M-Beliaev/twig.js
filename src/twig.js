var Twig = (function (Twig) {
    "use strict";

    Twig.trace = false;
    Twig.debug = false;

    /**
     * Container for methods related to handling high level template tokens
     *      (for example: {{ expression }}, {% logic %}, {# comment #}, raw data)
     */
    Twig.token = {};

    /**
     * Token types.
     */
    Twig.token.type = {
        output:  'output',
        logic:   'logic',
        comment: 'comment',
        raw:     'raw'
    };

    /**
     * Token syntax definitions.
     */
    Twig.token.definitions = {
        /**
         * Output type tokens.
         *  These typically take the form {{ expression }}.
         */
        output: {
            type: Twig.token.type.output,
            open: '{{',
            close: '}}'
        },
        /**
         * Logic type tokens.
         *  These typically take a form like {% if expression %} or {% endif %}
         */
        logic: {
            type: Twig.token.type.logic,
            open: '{%',
            close: '%}'
        },
        /**
         * Comment type tokens.
         *  These take the form {# anything #}
         */
        comment: {
            type: Twig.token.type.comment,
            open: '{#',
            close: '#}'
        }
    };


    /**
     * What characters start "strings" in token definitions. We need this to ignore token close
     * strings inside an expression.
     */
    Twig.token.strings = ['"', "'"];

    Twig.token.findStart = function (template) {
        var output = {
                position: null,
                def: null
            },
            token_type,
            token_template,
            first_key_position;

        for (token_type in Twig.token.definitions) {
            if (Twig.token.definitions.hasOwnProperty(token_type)) {
                token_template = Twig.token.definitions[token_type];
                first_key_position = template.indexOf(token_template.open);

                if (Twig.trace) {
                    console.log("Twig.token.findStart: ", "Searching for ", token_template.open, " found at ", first_key_position);
                }

                // Does this token occur before any other types?
                if (first_key_position >= 0 && (output.position === null || first_key_position < output.position)) {
                    output.position = first_key_position;
                    output.def = token_template;
                }
            }
        }

        return output;
    };

    Twig.token.findEnd = function (template, token_def, start) {
        var end = null,
            found = false,
            offset = 0,

            // For loop variables
            i,
            l;

        while (!found) {
            var str_pos = null,
                str_found = null,
                pos = template.indexOf(token_def.close, offset);

            if (pos >= 0) {
                end = pos;
                found = true;
            } else {
                // throw an exception
                throw "Unable to find closing bracket '" + token_def.close + "'"
                    + " opened near template position " + start;
            }

            l = Twig.token.strings.length;
            for (i = 0; i < l; i += 1) {
                var str = Twig.token.strings[i];
                var this_str_pos = template.indexOf(str, offset);
                if (this_str_pos > 0
                        && this_str_pos < pos
                        && (str_pos === null || this_str_pos < str_pos)) {

                    str_pos = this_str_pos;
                    str_found = str;
                }
            }

            // We found a string before the end of the token, now find the string's end and set the search offset to it
            if (str_pos !== null) {
                var end_offset = str_pos + 1;
                end = null;
                found = false;
                while (true) {
                    var end_str_pos = template.indexOf(str_found, end_offset);
                    if (end_str_pos < 0) {
                        throw "Unclosed string in template";
                    }
                    // Ignore escaped quotes
                    if (template.substr(end_str_pos - 1, 1) !== "\\") {
                        offset = end_str_pos + 1;
                        break;
                    } else {
                        end_offset = end_str_pos + 1;
                    }
                }
            }
        }
        return end;
    };

    /**
     * Convert a template into high-level tokens.
     */
    Twig.tokenize = function (template) {
        var tokens = [],
            error_offset = 0;

        while (template.length > 0) {
            // Find the first occurance of any token type in the template
            var found_token = Twig.token.findStart(template);
            if (Twig.trace) {
                console.log("Twig.tokenize: ", "Found token: ", found_token);
            }

            if (found_token.position !== null) {
                // Add a raw type token for anything before the start of the token
                if (found_token.position > 0) {
                    tokens.push({
                        type: Twig.token.type.raw,
                        value: template.substring(0, found_token.position)
                    });
                }
                template = template.substr(found_token.position + found_token.def.open.length);
                error_offset += found_token.position + found_token.def.open.length;

                // Find the end of the token
                var end = Twig.token.findEnd(template, found_token.def, error_offset);
                if (Twig.trace) {
                    console.log("Twig.tokenize: ", "Token ends at ", end);
                }

                var token_str = template.substring(0, end).trim();
                tokens.push({
                    type: found_token.def.type,
                    value: token_str
                });

                template = template.substr(end + found_token.def.close.length);
                error_offset += end + found_token.def.close.length;

            } else {
                // No more tokens -> add the rest of the template as a raw-type token
                tokens.push({
                    type: Twig.token.type.raw,
                    value: template
                });
                template = '';
            }
        }

        return tokens;
    };


    Twig.compile = function (tokens) {
        // Output and intermediate stacks
        var output = [],
            stack = [],
            intermediate_output = [],
            token,
            logic_token,
            expression_token,
            // Temporary previous token.
            prev_token,
            // The previous token's template
            prev_template,
            // The output token
            tok_output;

        while (tokens.length > 0) {
            token = tokens.shift();
            switch (token.type) {
                case Twig.token.type.raw:
                    if (stack.length > 0) {
                        intermediate_output.push(token);
                    } else {
                        output.push(token);
                    }
                    break;

                case Twig.token.type.logic:
                    // Compile the logic token
                    logic_token = Twig.logic.compile(token);
                    var type = logic_token.type,
                        token_template = Twig.logic.handler[type],
                        open = token_template.open,
                        next = token_template.next;

                    if (Twig.trace) {
                        console.log("Twig.compile: ", "Compiled logic token to ", logic_token,
                                                      " next is: ", next, " open is : ", open);
                    }

                    // Not a standalone token, check logic stack to see if this is expected
                    if (open !== undefined && !open) {
                        prev_token = stack.pop();
                        prev_template = Twig.logic.handler[prev_token.type];

                        if (prev_template.next.indexOf(type) < 0) {
                            throw type + " not expected after a " + prev_token.type;
                        }

                        prev_token.output = prev_token.output || [];

                        prev_token.output = prev_token.output.concat(intermediate_output);
                        intermediate_output = [];

                        tok_output = {
                            type: Twig.token.type.logic,
                            token: prev_token
                        };
                        if (stack.length > 0) {
                            intermediate_output.push(tok_output);
                        } else {
                            output.push(tok_output);
                        }
                    }

                    // This token requires additional tokens to complete the logic structure.
                    if (next !== undefined && next.length > 0) {
                        if (Twig.trace) {
                            console.log("Twig.compile: ", "Pushing ", logic_token, " to logic stack.");
                        }
                        if (stack.length > 0) {
                            // Put any currently held output into the output list of the logic operator
                            // currently at the head of the stack before we push a new one on.
                            prev_token = stack.pop();
                            prev_token.output = prev_token.output || [];
                            prev_token.output = prev_token.output.concat(intermediate_output);
                            stack.push(prev_token);
                        }

                        // Push the new logic token onto the logic stack
                        stack.push(logic_token);

                    } else if (open !== undefined && open) {
                        tok_output = {
                            type: Twig.token.type.logic,
                            token: logic_token
                        };
                        // Standalone token (like {% set ... %}
                        if (stack.length > 0) {
                            intermediate_output.push(tok_output);
                        } else {
                            output.push(tok_output);
                        }
                    }
                    break;

                case Twig.token.type.comment:
                    // Do nothing, comments should be ignored
                    break;

                case Twig.token.type.output:
                    expression_token = Twig.expression.compile(token);
                    if (stack.length > 0) {
                        intermediate_output.push(expression_token);
                    } else {
                        output.push(expression_token);
                    }
                    break;
            }

            if (Twig.trace) {
                console.log("Twig.compile: ", " Output: ", output,
                                              " Logic Stack: ", stack,
                                              " Pending Output: ", intermediate_output );
            }
        }
        if (stack.length > 0) {
            var unclosed_token = stack.pop();
            throw "Unable to find an end tag for " + unclosed_token.type
                + ", expecting one of " + unclosed_token.next.join(", ");
        }
        return output;
    };

    Twig.parse = function (tokens, context) {
        var output = [];
        // Track logic chains
        var chain = true;
        tokens.forEach(function (token) {
            if (Twig.debug) {
                console.log("Twig.parse: ", "Parsing token: ", token);
            }
            switch (token.type) {
                case Twig.token.type.raw:
                    output.push(token.value);
                    break;

                case Twig.token.type.logic:
                    var logic_token = token.token,
                        logic = Twig.logic.parse(logic_token, context, chain);

                    if (logic.chain !== undefined) {
                        chain = logic.chain;
                    }
                    if (logic.context !== undefined) {
                        context = logic.context;
                    }
                    if (logic.output !== undefined) {
                        output.push(logic.output);
                    }
                    break;

                case Twig.token.type.comment:
                    // Do nothing, comments should be ignored
                    break;

                case Twig.token.type.output:
                    // Parse the given expression in the given context
                    output.push(Twig.expression.parse(token.stack, context));
                    break;
            }
        });
        return output.join("");
    };

    /**
     * A Twig Template model.
     *
     * Holds a set of compiled tokens ready to be rendered.
     */
    Twig.Template = function ( tokens ) {
        this.tokens = tokens;
        this.render = function (context) {
            if (Twig.debug) {
                console.log("Twig.Template: ", "Rendering template with context: ", context);
            }
            var output = Twig.parse(tokens, context);

            if (Twig.debug) {
                console.log("Twig.Template: ", "Template rendered to: ", output);
            }
            return output;
        };
    };

    return Twig;

}) ( Twig || { } );

/**
 * Create and compile a Twig template.
 *
 * Returns a Twig.Template ready for rendering.
 */
var twig = function (params) {
    'use strict';
    var raw_tokens,
        tokens;

    if (params.debug !== undefined) {
        Twig.debug = params.debug;
    }

    if (Twig.debug) {
        console.log("twig(): ", "Tokenizing ", params.data);
    }

    raw_tokens = Twig.tokenize(params.data);

    if (Twig.debug) {
        console.log("twig(): ", "Compiling ", raw_tokens);
    }

    tokens = Twig.compile(raw_tokens);

    if (Twig.debug) {
        console.log("twig(): ", "Compiled ", tokens);
    }

    return new Twig.Template( tokens );
};
