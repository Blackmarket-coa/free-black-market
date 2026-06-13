import { logger } from "@lib/logger"
import { useState } from "react";

import { Button, Label, Select, Switch, toast } from "@medusajs/ui";

import type { ConfigurationRuleType } from "@custom-types/configuration";

import { useCreateConfigurationRule } from "@hooks/api/configuration";

type RuleType =
  | "global_product_catalog"
  | "require_product_approval"
  | "product_request_enabled"
  | "product_import_enabled";

type Props = {
  onSuccess?: () => void;
};

const CreateConfigurationRuleForm = ({ onSuccess }: Props) => {
  const [type, setType] = useState<RuleType>("global_product_catalog");
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);

  const { mutateAsync: createRule } = useCreateConfigurationRule({});
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    try {
      await createRule({
        rule_type: type as ConfigurationRuleType,
        is_enabled: enabled,
      });
      onSuccess?.();
      setLoading(false);
    } catch (e: unknown) {
      toast.error((e as Error).message);
      logger.error(e);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <fieldset className="my-4">
        <legend className="mb-2">Rule type</legend>
        <Select
          value={type}
          onValueChange={(value) => {
            setType(value as RuleType);
          }}
        >
          <Select.Trigger>
            <Select.Value placeholder="Type" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="global_product_catalog">
              global_product_catalog
            </Select.Item>
            <Select.Item value="require_product_approval">
              require_product_approval
            </Select.Item>
            <Select.Item value="product_request_enabled">
              product_request_enabled
            </Select.Item>
            <Select.Item value="product_import_enabled">
              product_import_enabled
            </Select.Item>
          </Select.Content>
        </Select>
      </fieldset>
      <fieldset className="my-4">
        <div className="flex items-center gap-x-2">
          <Switch
            id="is_enabled"
            onCheckedChange={(val) => {
              setEnabled(val);
            }}
          />
          <Label>Is rule enabled</Label>
        </div>
      </fieldset>
      <Button type="submit" isLoading={loading}>
        Create
      </Button>
    </form>
  );
};

export default CreateConfigurationRuleForm;
