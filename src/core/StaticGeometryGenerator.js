import { BufferAttribute, BufferGeometry } from 'three';
import { convertToStaticGeometry, copyAttributeContents, createAttributeClone } from './utils/convertToStaticGeometry';
import { GeometryDiff } from './utils/GeomDiff';

// Modified version of BufferGeometryUtils.mergeBufferGeometries that ignores morph targets and updates a attributes in place
function mergeBufferGeometries( geometries, options = { useGroups: false, updateIndex: false, skipAttributes: [] }, targetGeometry = new BufferGeometry() ) {

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

function flatTraverseMeshes( objects, cb ) {

	for ( let i = 0, l = objects.length; i < l; i ++ ) {

		const object = objects[ i ];
		object.traverse( o => {

			if ( o.isMesh ) {

				cb( o );

			}

		} );

	}

}

export class StaticGeometryGenerator {

	constructor( objects ) {

		if ( ! Array.isArray( objects ) ) {

			objects = [ objects ];

		}

		this.objects = objects;
		this.useGroups = true;
		this.applyWorldTransforms = true;
		this.attributes = [ 'position', 'normal', 'color', 'tangent', 'uv', 'uv2' ];
		this._intermediateGeometry = new Map();
		this._diffMap = new WeakMap();
		this._mergeOrder = [];

	}

	getMaterials() {

		const materials = [];
		flatTraverseMeshes( this.objects, mesh => {

			if ( Array.isArray( mesh.material ) ) {

				materials.push( ...mesh.material );

			} else {

				materials.push( mesh.material );

			}

		} );
		return materials;

	}

	generate( targetGeometry = new BufferGeometry() ) {

		// track which attributes have been updated and which to skip to avoid unnecessary attribute copies
		const skipAttributes = [];
		const { objects, useGroups, _intermediateGeometry, _diffMap, _mergeOrder } = this;
		const unusedMeshes = new Set( _intermediateGeometry.keys() );
		const mergeGeometry = [];
		flatTraverseMeshes( objects, mesh => {

			// get the intermediate geometry object to transform data into
			unusedMeshes.delete( mesh );
			if ( ! _intermediateGeometry.has( mesh ) ) {

				_intermediateGeometry.set( mesh, new BufferGeometry() );

			}

			// transform the geometry into the intermediate buffer geometry, saving whether
			// or not it changed.
			const geom = _intermediateGeometry.get( mesh );
			const diff = _diffMap.get( mesh );
			if ( ! diff || diff.didChange( mesh ) ) {

				this._convertToStaticGeometry( mesh, geom );
				skipAttributes.push( false );

				if ( ! diff ) {

					_diffMap.set( mesh, new GeometryDiff( mesh ) );

				} else {

					diff.update();

				}

			} else {

				skipAttributes.push( true );

			}

			mergeGeometry.push( geom );

		} );

		// if we've seen that the order of geometry has changed then make sure we don't
		// skip the assignment of attributes.
		for ( let i = 0, l = mergeGeometry.length; i < l; i ++ ) {

			const newGeo = mergeGeometry[ i ];
			const oldGeo = _mergeOrder[ i ];
			if ( newGeo !== oldGeo ) {

				skipAttributes[ i ] = false;

			}

		}

		// If we have no geometry to merge then provide an empty geometry.
		if ( mergeGeometry.length === 0 ) {

			// if there are no geometries then just create a fake empty geometry to provide
			targetGeometry.setIndex( null );

			// remove all geometry
			const attrs = targetGeometry.attributes;
			for ( const key in attrs ) {

				targetGeometry.deleteAttribute( key );

			}

			// create dummy attributes
			for ( const key in this.attributes ) {

				targetGeometry.setAttribute( this.attributes[ key ], new BufferAttribute( new Float32Array( 0 ), 4, false ) );

			}

		} else {

			mergeBufferGeometries( mergeGeometry, { useGroups, skipAttributes }, targetGeometry );

		}

		// Mark all attributes as needing an update
		for ( const key in targetGeometry.attributes ) {

			targetGeometry.attributes[ key ].needsUpdate = true;

		}

		// Remove any unused intermediate meshes
		unusedMeshes.forEach( key => {

			_intermediateGeometry.delete( key );

		} );

		this._mergeOrder = mergeGeometry;

		return targetGeometry;

	}

	_convertToStaticGeometry( mesh, targetGeometry = new BufferGeometry() ) {

		return convertToStaticGeometry( mesh, {
			attributes: this.attributes,
			applyWorldTransforms: this.applyWorldTransforms,
		}, targetGeometry );

	}

}
