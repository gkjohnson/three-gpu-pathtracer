import { BufferAttribute, BufferGeometry } from 'three';
import { copyAttributeContents, createAttributeClone } from './BufferAttributeUtils.js';

function clearGeometryAttributes( geometries, target ) {

	let indexLength = 0;
	let attrLength = 0;
	for ( let i = 0, l = geometries.length; i < l; i ++ ) {

		indexLength += geometries[ i ].index.count;
		attrLength += geometries[ i ].attributes.position.count;

	}

}

function validateMergeability( geometries ) {

	const isIndexed = geometries[ 0 ].index !== null;
	const attributesUsed = new Set( Object.keys( geometries[ 0 ].attributes ) );
	if ( ! geometries[ 0 ].getAttribute( 'position' ) ) {

		throw new Error( 'StaticGeometryGenerator: position attribute is required.' );

	}

	for ( let i = 0; i < geometries.length; ++ i ) {

		const geometry = geometries[ i ];
		let attributesCount = 0;

		// ensure that all geometries are indexed, or none
		if ( isIndexed !== ( geometry.index !== null ) ) {

			throw new Error( 'StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.' );

		}

		// gather attributes, exit early if they're different
		for ( const name in geometry.attributes ) {

			if ( ! attributesUsed.has( name ) ) {

				throw new Error( 'StaticGeometryGenerator: All geometries must have compatible attributes; make sure "' + name + '" attribute exists among all geometries, or in none of them.' );

			}

			attributesCount ++;

		}

		// ensure geometries have the same number of attributes
		if ( attributesCount !== attributesUsed.size ) {

			throw new Error( 'StaticGeometryGenerator: All geometries must have the same number of attributes.' );

		}

	}

}

function getTotalIndexCount( geometries ) {

	let result = 0;
	for ( let i = 0, l = geometries.length; i < l; i ++ ) {

		result += geometries[ i ].count;

	}

	return result;

}

function getTotalAttributeCount( geometries ) {

	let result = 0;
	for ( let i = 0, l = geometries.length; i < l; i ++ ) {

		result += geometries[ i ].getAttribute( 'position' ).count;

	}

	return result;

}

function trimMismatchedAttributes( target, indexCount, attrCount ) {

	if ( target.index && target.index.count !== indexCount ) {

		target.setIndex( null );

	}

	const attributes = target.attributes;
	for ( const key in attributes ) {

		const attr = attributes[ key ];
		if ( attr.count !== attrCount ) {

			target.deleteAttribute( key );

		}

	}

}

// Modified version of BufferGeometryUtils.mergeBufferGeometries that ignores morph targets and updates a attributes in place
export function mergeGeometries( geometries, options = {}, targetGeometry = new BufferGeometry() ) {

	// TODO: do we limit the attributes here?
	const {
		useGroups = false,
		forceUpdateAll = false,
		skipAssigningAttributes = [],
	} = options;

	// check if we can merge these geometries
	validateMergeability( geometries );

	const isIndexed = geometries[ 0 ].index !== null;
	const totalIndexCount = isIndexed ? getTotalIndexCount( geometries ) : - 1;
	const totalAttributeCount = getTotalAttributeCount( geometries );
	trimMismatchedAttributes( targetGeometry, totalIndexCount, totalAttributeCount );

	// set up groups
	if ( useGroups ) {

		let offset = 0;
		for ( let i = 0, l = geometries.length; i < l; i ++ ) {

			const geometry = geometries[ i ];

			let primitiveCount;
			if ( isIndexed ) {

				primitiveCount = geometry.getIndex().count;

			} else {

				primitiveCount = geometry.getAttribute( 'position' ).count;

			}

			targetGeometry.addGroup( offset, primitiveCount, i );
			offset += primitiveCount;

		}

	}

	// TODO: if we rearrange geometry and it results in the same sized attributes then
	// we can't rely on the the "skip" capability. It may be okay to also pass in the previous
	// offset position to determine if it's shifted but it may not be worth it.

	// generate the final geometry
	// skip the assigning any attributes for items in the above array
	if ( isIndexed ) {

		// set up the index if it doesn't exist
		let forceUpdateIndex = false;
		if ( ! targetGeometry.index ) {

			targetGeometry.setIndex( new BufferAttribute( new Uint32Array( totalIndexCount ), 1, false ) );
			forceUpdateIndex = true;

		}

		// copy the index data to the target geometry
		let targetOffset = 0;
		let indexOffset = 0;
		const targetIndex = targetGeometry.getIndex();
		for ( let i = 0, l = geometries.length; i < l; i ++ ) {

			const geometry = geometries[ i ];
			const skip = ! forceUpdateIndex && skipAssigningAttributes[ i ];
			if ( ! skip ) {

				const index = geometry.getIndex();
				for ( let j = 0; j < index.count; ++ j ) {

					targetIndex.setX( targetOffset, index.getX( j ) + indexOffset );
					targetOffset ++;

				}

			}

			indexOffset += geometry.getAttribute( 'position' ).count;

		}

	}

	// copy all the attribute data over
	const attributes = Object.keys( geometries[ 0 ].attributes );
	for ( let i = 0, l = attributes.length; i < l; i ++ ) {

		let forceUpdate = false;
		const key = attributes[ i ];
		if ( ! targetGeometry.getAttribute( key ) ) {

			// TODO: add attribute
			forceUpdate = true;

		}

		let offset = 0;
		const targetAttribute = targetGeometry.getAttribute( key );
		for ( let g = 0, l = geometries.length; g < l; g ++ ) {

			const geometry = geometries[ g ];
			const skip = ! forceUpdate && skipAssigningAttributes[ i ];
			const attr = geometry.getAttribute( key );
			if ( ! skip ) {

				copyAttributeContents( attr, targetAttribute, offset );

			}

			offset += attr.count;

		}

	}


}



export function mergeGeometries2( geometries, options = {}, targetGeometry = new BufferGeometry() ) {














	const isIndexed = geometries[ 0 ].index !== null;
	const { useGroups = false, updateIndex = false, skipAttributes = [] } = options;

	const attributesUsed = new Set( Object.keys( geometries[ 0 ].attributes ) );
	const attributes = {};

	let offset = 0;

	targetGeometry.clearGroups();
	for ( let i = 0; i < geometries.length; ++ i ) {

		const geometry = geometries[ i ];
		let attributesCount = 0;

		// ensure that all geometries are indexed, or none
		if ( isIndexed !== ( geometry.index !== null ) ) {

			throw new Error( 'StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.' );

		}

		// gather attributes, exit early if they're different
		for ( const name in geometry.attributes ) {

			if ( ! attributesUsed.has( name ) ) {

				throw new Error( 'StaticGeometryGenerator: All geometries must have compatible attributes; make sure "' + name + '" attribute exists among all geometries, or in none of them.' );

			}

			if ( attributes[ name ] === undefined ) {

				attributes[ name ] = [];

			}

			attributes[ name ].push( geometry.attributes[ name ] );
			attributesCount ++;

		}

		// ensure geometries have the same number of attributes
		if ( attributesCount !== attributesUsed.size ) {

			throw new Error( 'StaticGeometryGenerator: Make sure all geometries have the same number of attributes.' );

		}

		if ( useGroups ) {

			let count;
			if ( isIndexed ) {

				count = geometry.index.count;

			} else if ( geometry.attributes.position !== undefined ) {

				count = geometry.attributes.position.count;

			} else {

				throw new Error( 'StaticGeometryGenerator: The geometry must have either an index or a position attribute' );

			}

			targetGeometry.addGroup( offset, count, i );
			offset += count;

		}

	}

	// merge indices
	if ( isIndexed ) {

		let forceUpdateIndex = false;
		if ( ! targetGeometry.index ) {

			let indexCount = 0;
			for ( let i = 0; i < geometries.length; ++ i ) {

				indexCount += geometries[ i ].index.count;

			}

			targetGeometry.setIndex( new BufferAttribute( new Uint32Array( indexCount ), 1, false ) );
			forceUpdateIndex = true;

		}

		if ( updateIndex || forceUpdateIndex ) {

			const targetIndex = targetGeometry.index;
			let targetOffset = 0;
			let indexOffset = 0;
			for ( let i = 0; i < geometries.length; ++ i ) {

				const geometry = geometries[ i ];
				const index = geometry.index;
				if ( skipAttributes[ i ] !== true ) {

					for ( let j = 0; j < index.count; ++ j ) {

						targetIndex.setX( targetOffset, index.getX( j ) + indexOffset );
						targetOffset ++;

					}

				}

				indexOffset += geometry.attributes.position.count;

			}

		}

	}

	// merge attributes
	for ( const name in attributes ) {

		const attrList = attributes[ name ];
		if ( ! ( name in targetGeometry.attributes ) ) {

			let count = 0;
			for ( const key in attrList ) {

				count += attrList[ key ].count;

			}

			targetGeometry.setAttribute( name, createAttributeClone( attributes[ name ][ 0 ], count ) );

		}

		const targetAttribute = targetGeometry.attributes[ name ];
		let offset = 0;
		for ( let i = 0, l = attrList.length; i < l; i ++ ) {

			const attr = attrList[ i ];
			if ( skipAttributes[ i ] !== true ) {

				copyAttributeContents( attr, targetAttribute, offset );

			}

			offset += attr.count;

		}

	}

	return targetGeometry;

}