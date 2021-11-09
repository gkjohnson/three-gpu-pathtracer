import { Scene, WebGLRenderer, MeshBasicMaterial } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/pass.js';
import { PathTracingRenderer } from '../utils/PathTracingRenderer.js';
import { mergeMeshes } from '../utils/GeometryPreparationUtils.js';

export class PathTracingViewer {

    constructor() {

        this.scene = new Scene();
        this.renderer = new WebGLRenderer();
        this.fsQuad = new FullScreenQuad( new MeshBasicMaterial() );
        this.ptRenderer = new PathTracingRenderer( this.renderer );
        this.ptModel = null;
        this.ptMaterials = null;
        this.model = null;

    }

    setSize( w, h ) {

        this.renderer.setSize( w, h );
        this.ptRenderer.setSize( w, h );

    }

    setModel( object ) {

        if ( this.model ) {

            this.model = null;
            this.ptMaterials = null;
            this.ptModel = null;

        }

        object.updateMatrixWorld( true );

        const meshes = [];
        object.traverse( c => {

            if ( c.isMesh ) {

                meshes.push( c );

            }

        } );


        const { geometry, materials } = mergeMeshes( meshes, { attributes: [ 'normal', 'uv' ] } );
        const mesh = new Mesh( geometry );

        this.scene.add( object );
        this.ptModel = mesh;
        this.ptMaterials = materials;
        this.model = object;

    }

    setEnvironment( envMap ) {

        this.scene.environment = envMap;

    }

    init() {

        const { ptRenderer, renderer, fsQuad } = this;

        const controls = new OrbitControls( this.renderer.domElement );
        controls.addEventListener( () => {

            ptRenderer.reset();

        } );

        renderer.setAnimationLoop( () => {

            ptRenderer.update();

            fsQuad.material.map = ptRenderer.target;
            fsQuad.render( renderer );

        } );

    }

}
