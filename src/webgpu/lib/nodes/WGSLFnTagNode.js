import { FunctionNode, Node } from 'three/webgpu';

// minimal node that outputs a raw WGSL expression verbatim when built,
// bypassing TSL's temp variable wrapping and type formatting
class RawExpression extends Node {

	constructor( code ) {

		super();
		this.code = code;

	}

	build() {

		return this.code;

	}

}

// returns the StructTypeNode from either a direct StructTypeNode or a struct() callable wrapper
function getStructLayout( arg ) {

	if ( arg && arg.isNode && arg.isStructLayoutNode ) return arg;
	if ( typeof arg === 'function' && arg.isStruct ) return arg.layout;
	return null;

}

// replaces any string parameters on a FunctionCallNode with RawExpression nodes
// so they output as raw WGSL identifiers (e.g. local variable names)
function convertStringParams( callNode ) {

	const params = callNode.parameters;
	if ( params && typeof params === 'object' && ! Array.isArray( params ) && ! params.isNode ) {

		const converted = {};
		for ( const key in params ) {

			const v = params[ key ];
			converted[ key ] = ( typeof v === 'string' ) ? new RawExpression( v ) : v;

		}

		callNode.setParameters( converted );

	}

}

// returns the node that should be registered as an include for the given arg,
// or null if the arg doesn't represent a dependency (e.g. a string, number, or plain node)
function getIncludeNode( arg ) {

	if ( typeof arg === 'function' && arg.functionNode ) return arg.functionNode;
	if ( arg && arg.isNode && arg.functionNode ) return arg.functionNode;
	if ( getStructLayout( arg ) ) return getStructLayout( arg );
	if ( arg && arg.isNode && arg.isCodeNode ) return arg;
	return null;

}

export class WGSLFnTagNode extends FunctionNode {

	static get type() {

		return 'WGSLFnTagNode';

	}

	constructor( tokens, args, lang = 'wgsl' ) {

		// extract dependencies for includes — function definitions, struct types,
		// and code nodes need to be pre-registered so their code appears before ours.
		// callable wrappers and FunctionCallNodes are unwrapped to the underlying FunctionNode;
		// plain nodes (uniforms, storage, etc) are built inline in generate() and don't need includes.
		// arrays are treated as explicit include lists — each element is registered as a dependency.
		const includes = [];

		for ( const arg of args ) {

			if ( Array.isArray( arg ) ) {

				for ( const element of arg ) {

					// unwrap callable wrappers; accept any remaining node directly
					// (storage, uniforms, etc. need to be built to register bindings)
					const node = getIncludeNode( element );
					if ( node ) includes.push( node );
					else if ( element && element.isNode ) includes.push( element );

				}

			} else {

				const node = getIncludeNode( arg );
				if ( node ) includes.push( node );

			}

		}

		super( '', includes, lang );

		this.tokens = tokens;
		this.args = args;

	}

	// assemble the signature from tokens and arg names (struct types may appear
	// in the signature as return types or parameter types), then parse it
	getNodeFunction( builder ) {

		const { tokens, args } = this;
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

						fullCode += String( arg );

					} else {

						const structLayout = getStructLayout( arg );
						if ( structLayout ) {

							// use getNodeType to get the correct name (may be auto-generated)
							fullCode += structLayout.getNodeType( builder );

						} else {

							fullCode += '_arg' + i;

						}

					}

				}

			}

			const braceIndex = fullCode.indexOf( '{' );
			let sig = braceIndex !== - 1 ? fullCode.substring( 0, braceIndex ) : fullCode;
			sig = sig.replace( /\/\/.+[\n\r]/g, '' );

			nodeFunction = builder.parser.parseFunction( sig + ' {}' );
			nodeData.nodeFunction = nodeFunction;

		}

		return nodeFunction;

	}

	generate( builder, output ) {

		const { tokens, args } = this;

		// let FunctionNode.generate handle includes, code registration, property naming,
		// and type normalization (e.g. stripping "-> void" which is not valid WGSL)
		const result = super.generate( builder, output );

		// assemble the body by interleaving static tokens with resolved node names
		const parts = [];

		for ( let i = 0, l = tokens.length; i < l; i ++ ) {

			parts.push( tokens[ i ] );

			if ( i < args.length ) {

				const arg = args[ i ];
				if ( Array.isArray( arg ) ) {

					// include array — no text output

				} else if ( typeof arg === 'string' || typeof arg === 'number' ) {

					// raw literal — output verbatim
					parts.push( String( arg ) );

				} else if ( typeof arg === 'function' && arg.functionNode ) {

					// callable wrapper (from wgslFn/wgslFnTag) — resolve to function name
					parts.push( arg.functionNode.build( builder, 'property' ) );

				} else if ( arg.isNode && arg.functionNode ) {

					// FunctionCallNode — use generate() to get the inline call expression
					// (build() would wrap it in a temp variable that lives outside our WGSL scope).
					// convert any string params to RawExpression — the function may have been
					// created by wgslFn (which doesn't handle string-to-node conversion)
					convertStringParams( arg );
					parts.push( arg.generate( builder ) );

				} else if ( getStructLayout( arg ) ) {

					// struct (StructTypeNode or struct() callable) — build to register
					// the struct definition, output just the type name
					parts.push( getStructLayout( arg ).build( builder ) );

				} else {

					parts.push( arg.build( builder ) );

				}

			}

		}

		const { type } = this.getNodeFunction( builder );
		const nodeCode = builder.getCodeFromNode( this, type );

		// use the declaration from super (handles type normalization and name assignment),
		// replace its empty body with the assembled body from the template
		const declaration = nodeCode.code;
		const declPrefix = declaration.substring( 0, declaration.indexOf( '{' ) + 1 );

		const assembledCode = parts.join( '' );
		const bodyStart = assembledCode.indexOf( '{' ) + 1;
		const bodyEnd = assembledCode.lastIndexOf( '}' );
		const body = assembledCode.substring( bodyStart, bodyEnd );

		nodeCode.code = declPrefix + body + '}\n';

		return result;

	}

}

const wgslFnTag = ( tokens, ...args ) => {

	const functionNode = new WGSLFnTagNode( tokens, args );

	const fn = ( ...params ) => {

		// wrap string parameter values as raw WGSL expressions
		// so they output verbatim as identifiers (e.g. local variable names)
		if ( params.length === 1 && params[ 0 ] && typeof params[ 0 ] === 'object' && ! params[ 0 ].isNode ) {

			const obj = params[ 0 ];
			for ( const key in obj ) {

				if ( typeof obj[ key ] === 'string' ) {

					obj[ key ] = new RawExpression( obj[ key ] );

				}

			}

		}

		return functionNode.call( ...params );

	};

	fn.functionNode = functionNode;

	return fn;

};

export {
	wgslFnTag,
};
