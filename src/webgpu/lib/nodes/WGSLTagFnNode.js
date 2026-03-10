import { CodeNode, FunctionCallNode, FunctionNode, Node } from 'three/webgpu';

// minimal node that outputs a raw WGSL expression verbatim when built
class LiteralExpression extends Node {

	constructor( literal ) {

		super();
		this.literal = literal;

	}

	build() {

		return this.literal;

	}

}

// wraps a FunctionNode so that build() returns just the function name
class PropertyRefNode extends Node {

	constructor( node ) {

		super();
		this.node = node;

	}

	build( builder ) {

		return this.node.build( builder, 'property' );

	}

}

// wraps a FunctionCallNode so that build() returns the inline call expression,
// bypassing TempNode's variable wrapping
class InlineCallNode extends Node {

	constructor( node ) {

		super();
		this.node = node;

	}

	build( builder ) {

		return this.node.generate( builder );

	}

}

// returns the node that should be registered as an include for the given arg
function getIncludeNode( arg ) {

	if ( typeof arg === 'function' ) {

		if ( arg.functionNode ) return arg.functionNode;
		if ( arg.isStruct ) return arg.layout;
		else return null;

	} else if ( arg.functionNode ) {

		return arg.functionNode;

	} else if ( arg.isNode ) {

		return new PropertyRefNode( arg );

	} else {

		return null;

	}

}

// extract dependency nodes from template args for include registration
function extractIncludes( args ) {

	const includes = [];
	for ( const arg of args ) {

		if ( Array.isArray( arg ) ) {

			for ( const element of arg ) {

				const node = getIncludeNode( element );
				if ( node ) includes.push( node );

			}

		} else {

			const node = getIncludeNode( arg );
			if ( node ) includes.push( node );

		}

	}

	return includes;

}

// replace any string values in a keyed params object with LiteralExpression
function wrapStringValues( obj ) {

	const wrapped = {};
	for ( const key in obj ) {

		wrapped[ key ] = typeof obj[ key ] === 'string' ? new LiteralExpression( obj[ key ] ) : obj[ key ];

	}

	return wrapped;

}

// return a new FunctionCallNode with string parameter values replaced by LiteralExpression
function wrapStringParams( callNode ) {

	const params = callNode.parameters;
	let wrapped;
	if ( Array.isArray( params ) ) {

		wrapped = params.map( p => typeof p === 'string' ? new LiteralExpression( p ) : p );

	} else if ( params && typeof params === 'object' ) {

		wrapped = wrapStringValues( params );

	} else {

		debugger
		return callNode;

	}

	return new FunctionCallNode( callNode.functionNode, wrapped );

}

// normalize args so generate can resolve them uniformly with build():
// - callable wrappers > PropertyRefNode (emits just the function name)
// - struct callables > StructTypeNode (emits the type name via build)
// - FunctionCallNodes > InlineCallNode (emits inline call)
function normalizeArgs( args ) {

	return args.map( arg => {

		if ( typeof arg === 'function' && arg.functionNode ) return new PropertyRefNode( arg.functionNode );
		if ( typeof arg === 'function' && arg.isStruct ) return arg.layout;
		if ( arg && arg.isNode && arg.functionNode ) return new InlineCallNode( wrapStringParams( arg ) );
		if ( arg && arg.isNode ) return new PropertyRefNode( arg );
		return arg;

	} );

}

// interleave static tokens with resolved arg values
function assembleTemplate( tokens, args, builder ) {

	let code = '';
	for ( let i = 0, l = tokens.length; i < l; i ++ ) {

		code += tokens[ i ];
		if ( i < args.length ) {

			const arg = args[ i ];
			if ( Array.isArray( arg ) ) {

				// include array — no text output

			} else if ( typeof arg === 'string' || typeof arg === 'number' ) {

				code += String( arg );

			} else {

				code += arg.build( builder );

			}

		}

	}

	return code;

}

export class WGSLTagFnNode extends FunctionNode {

	static get type() {

		return 'WGSLFnTagNode';

	}

	constructor( tokens, args, lang = 'wgsl' ) {

		super( '', [], lang );

		this.tokens = tokens;
		this.rawArgs = args;

	}

	getIncludes( /*builder*/ ) {

		return extractIncludes( normalizeArgs( this.rawArgs ) );

	}

	// assemble the signature from tokens and arg names then parse
	getNodeFunction( builder ) {

		const { tokens, rawArgs } = this;
		const args = normalizeArgs( rawArgs );

		const nodeData = builder.getDataFromNode( this );
		let nodeFunction = nodeData.nodeFunction;
		if ( nodeFunction === undefined ) {

			// reconstruct the full code with known names for struct args
			// and dummy identifiers for everything else
			let fullCode = '';
			for ( let i = 0, l = tokens.length; i < l; i ++ ) {

				fullCode += tokens[ i ];

				if ( i < args.length ) {

					const arg = args[ i ];
					if ( Array.isArray( arg ) ) {

						// include array — no text output

					} else if ( typeof arg === 'string' || typeof arg === 'number' ) {

						// literals
						fullCode += String( arg );

					} else if ( arg.isStructLayoutNode ) {

						// struct type node
						fullCode += arg.getNodeType( builder );

					} else if ( arg.isStruct ) {

						// struct
						fullCode += arg.layout.getNodeType( builder );

					} else {

						fullCode += '_arg' + i;

					}

				}

			}

			// remove comments
			fullCode = fullCode.replace( /\/\/.+[\n\r]/g, '' );

			// parse it so we have the signature defined - we will define the body content after
			nodeFunction = builder.parser.parseFunction( fullCode );
			nodeData.nodeFunction = nodeFunction;

		}

		return nodeFunction;

	}

	// get the code for the function
	generate( builder, output ) {

		const result = super.generate( builder, output );
		const { rawArgs, tokens } = this;
		const args = normalizeArgs( rawArgs );
		const fullCode = assembleTemplate( tokens, args, builder );

		const { type } = this.getNodeFunction( builder );
		const nodeCode = builder.getCodeFromNode( this, type );

		nodeCode.code = fullCode.replace( /\/\/.+[\n\r]/g, '' ).replace( /->\s*void/, '' ).trim();

		return result;

	}

}

export class WGSLTagCodeNode extends CodeNode {

	static get type() {

		return 'WGSLTagCodeNode';

	}

	constructor( tokens, args, lang = 'wgsl' ) {

		super( '', [], lang );

		this.tokens = tokens;
		this.rawArgs = args;

	}

	generate( builder ) {

		const { tokens, rawArgs } = this;
		const args = normalizeArgs( rawArgs );

		// build includes so dependencies are registered before the parent code block
		for ( const include of extractIncludes( rawArgs ) ) {

			include.build( builder );

		}

		return assembleTemplate( tokens, args, builder );

	}

}

const getFn = functionNode => {

	const fn = ( ...params ) => functionNode.call( ...params );
	fn.functionNode = functionNode;
	return fn;

};

// template tag literal function version of "wgslFn" & "wgsl" to generate
// functions & code snippets respectively
export const wgslTagFn = ( tokens, ...args ) => getFn( new WGSLTagFnNode( tokens, args ) );
export const wgslTagCode = ( tokens, ...args ) => new WGSLTagCodeNode( tokens, args );

// glsl versions
export const glslTagFn = ( tokens, ...args ) => getFn( new WGSLTagFnNode( tokens, args, 'glsl' ) );
export const glslTagCode = ( tokens, ...args ) => new WGSLTagCodeNode( tokens, args, 'glsl' );
