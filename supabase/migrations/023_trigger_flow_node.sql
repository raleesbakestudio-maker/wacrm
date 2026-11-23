-- Migration 023: Add 'trigger_flow' node type to flow_nodes table
ALTER TABLE flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE flow_nodes ADD CONSTRAINT flow_nodes_node_type_check 
  CHECK (node_type = ANY (ARRAY[
    'start'::text,
    'send_buttons'::text,
    'send_list'::text,
    'send_message'::text,
    'send_media'::text,
    'collect_input'::text,
    'condition'::text,
    'set_tag'::text,
    'handoff'::text,
    'http_fetch'::text,
    'trigger_flow'::text,
    'end'::text
  ]));
